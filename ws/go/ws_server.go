package main

import (
	"encoding/json"
	"log"
	"net/http"
	"sync"

	"github.com/gorilla/mux"
	"github.com/gorilla/websocket"
)

type Client struct {
	conn *websocket.Conn
	send chan []byte
	room string
}

type Room struct {
	name    string
	clients map[*Client]bool
	lock    sync.Mutex
}

type Hub struct {
	rooms map[string]*Room
	lock  sync.Mutex
}

var hub = &Hub{
	rooms: make(map[string]*Room),
}

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool {
		// Allow all origins
		return true
	},
}

func main() {
	router := mux.NewRouter()
	router.HandleFunc("/comm", handleWebSocket)

	server := &http.Server{
		Addr:    "0.0.0.0:8080",
		Handler: router,
	}

	log.Println("WebSocket server running on ws://0.0.0.0:8080/comm")
	if err := server.ListenAndServe(); err != nil {
		log.Fatalf("Server error: %v", err)
	}
}

func handleWebSocket(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("Upgrade error: %v", err)
		return
	}
	client := &Client{conn: conn, send: make(chan []byte, 256)}
	go client.readMessages()
	go client.writeMessages()
}

func (client *Client) readMessages() {
	defer func() {
		client.disconnect()
	}()
	for {
		_, message, err := client.conn.ReadMessage()
		if err != nil {
			log.Printf("Read error: %v", err)
			break
		}
		var data map[string]interface{}
		if err := json.Unmarshal(message, &data); err != nil {
			log.Printf("JSON unmarshal error: %v", err)
			continue
		}

		action := data["action"].(string)
		room := ""
		if val, ok := data["room"]; ok {
			room = val.(string)
		}

		switch action {
		case "subscribe":
			hub.subscribe(client, room)
		default:
			hub.broadcast(room, message, client)
		}
	}
}

func (client *Client) writeMessages() {
	defer func() {
		client.conn.Close()
	}()
	for msg := range client.send {
		if err := client.conn.WriteMessage(websocket.TextMessage, msg); err != nil {
			log.Printf("Write error: %v", err)
			break
		}
	}
}

func (client *Client) disconnect() {
	hub.unsubscribe(client)
	close(client.send)
	client.conn.Close()
}

func (hub *Hub) subscribe(client *Client, roomName string) {
	hub.lock.Lock()
	defer hub.lock.Unlock()

	room, exists := hub.rooms[roomName]
	if !exists {
		room = &Room{
			name:    roomName,
			clients: make(map[*Client]bool),
		}
		hub.rooms[roomName] = room
	}

	room.lock.Lock()
	defer room.lock.Unlock()

	if len(room.clients) >= 2 {
		client.send <- []byte(`{"action":"subRejected"}`)
		return
	}
	room.clients[client] = true
	client.room = roomName
	hub.notify(roomName, client, `{"action":"newSub", "room":"`+roomName+`"}`)
}

func (hub *Hub) unsubscribe(client *Client) {
	if client.room == "" {
		return
	}
	hub.lock.Lock()
	defer hub.lock.Unlock()

	room, exists := hub.rooms[client.room]
	if !exists {
		return
	}

	room.lock.Lock()
	defer room.lock.Unlock()

	delete(room.clients, client)
	hub.notify(client.room, client, `{"action":"imOffline", "room":"`+client.room+`"`)
	if len(room.clients) == 0 {
		delete(hub.rooms, client.room)
	}
}

func (hub *Hub) broadcast(roomName string, message []byte, sender *Client) {
	hub.lock.Lock()
	defer hub.lock.Unlock()

	room, exists := hub.rooms[roomName]
	if !exists {
		return
	}

	room.lock.Lock()
	defer room.lock.Unlock()

	for client := range room.clients {
		if client != sender {
			client.send <- message
		}
	}
}

func (hub *Hub) notify(roomName string, sender *Client, message string) {
	room, exists := hub.rooms[roomName]
	if !exists {
		return
	}

	for client := range room.clients {
		if client != sender {
			client.send <- []byte(message)
		}
	}
}
