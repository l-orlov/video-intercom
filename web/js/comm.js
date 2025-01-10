'use strict';

// Config
const servers = {
    iceServers: [
        // Use google servers by default
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" },
        { urls: "stun:stun2.l.google.com:19302" },
        { urls: "stun:stun3.l.google.com:19302" },
        { urls: "stun:stun4.l.google.com:19302" }
    ]
};
const streamConstraints = { video: { facingMode: 'user' }, audio: true }

// Global variables
let myPC; // PeerConnection
let myMediaStream; // Media stream object
let wsChat; // WebSocket connection
let isUnsubscribed = false; // Tracks subscription status (if true can not start call)
let timerInterval = null; // Tracks call duration

// Button selectors
const toggleVideoButton = document.getElementById("toggleVideo");
const endCallButton = document.getElementById("endCall");

// Get room and ownership from query parameters
const { room, isOwner } = getRoomAndOwnership();

/* Event Listeners */
window.addEventListener('load', initializeApplication);

function initializeApplication() {
    setupInitialUI();
    fetchAdditionalIceServers();
    initializeWebSocket();
    setupButtonEventListeners();
}

/* Configures initial UI */
function setupInitialUI() {
    toggleVideoButton.style.display = "none"; // Hide video toggle for caller
    endCallButton.style.margin = "auto"; // Center end call button
}

/* Fetches additional ICE servers for fallback and adds them to default list */
function fetchAdditionalIceServers() {
    fetch(`${appRoot}Server.php`)
        .then(response => response.json())
        .then(iceServers => {
            servers.iceServers = servers.iceServers.concat(iceServers);
        })
        .catch(error => console.error("Error fetching ICE servers:", error));
}

/* Initializes WebSocket connection and sets up event handlers */
function initializeWebSocket() {
    wsChat = new WebSocket(`${wsUrl}/`);

    wsChat.onopen = () => {
        // Subscribe to room
        wsChat.send(JSON.stringify({ action: 'subscribe', room }));
        showSnackBar("Connected to WebSocket server!", 5000);
    };

    wsChat.onerror = () => {
        showSnackBar("Unable to connect to WebSocket server. Please refresh.", 20000);
    };

    wsChat.onmessage = handleWebSocketMessage;
}

/* Handles incoming WebSocket messages */
function handleWebSocketMessage(event) {
    const data = JSON.parse(event.data);

    if (data.room === room) {
        switch (data.action) {
            case 'startCall':
                // Start call by message from server
                startCall(data.isCaller);
                break;
            case 'candidate':
                if (myPC) myPC.addIceCandidate(new RTCIceCandidate(data.candidate));
                break;
            case 'sdp':
                if (myPC) myPC.setRemoteDescription(new RTCSessionDescription(data.sdp));
                break;
            case 'newSub':
                handleNewSubscriber();
                break;
            case 'imOnline':
                setRemoteStatus('online');
                break;
            case 'imOffline':
                handleRemoteOffline();
                break;
        }
    } else if (data.action === "subRejected") {
        showSnackBar("Only two users allowed in room. Communication disallowed.", 5000);
    }
}

function handleNewSubscriber() {
    setRemoteStatus('online');
    wsChat.send(JSON.stringify({ action: 'imOnline', room }));
    showSnackBar("Remote joined room.", 10000);
}

function handleRemoteOffline() {
    setRemoteStatus('offline');
    endCall();
    showSnackBar("Remote left room.", 10000);
}

/* Sets up event listeners for buttons */
function setupButtonEventListeners() {
    endCallButton.addEventListener('click', () => {
        endCall();
    });

    if (isOwner) {
        toggleVideoButton.addEventListener('click', toggleVideoStream);
    }
}

/* Extracts room and role from URL parameters and determines ownership */
function getRoomAndOwnership() {
    const params = new URLSearchParams(window.location.search);
    const room = params.get("room") || "";
    const isOwner = params.get("role") === "owner"; // Determine ownership
    return { room, isOwner };
}

/* Starts call */
function startCall(isCaller) {
    if (isUnsubscribed) {
        console.warn("Cannot start call: User is unsubscribed.");
        return;
    }

    startTimer();

    if (!checkUserMediaSupport()) {
        showSnackBar("Your browser does not support video calls.", 30000);
        return;
    }

    initializePeerConnection();

    // Set up local media
    setLocalMedia(streamConstraints, isCaller);

    // Show video toggle button for owner
    if (isOwner) {
        showVideoButtonForOwner();
    }
}

/* Initializes RTCPeerConnection and sets up event handlers */
function initializePeerConnection() {
    myPC = new RTCPeerConnection(servers);

    myPC.onicecandidate = handleIceCandidate;
    myPC.ontrack = handleRemoteStream;
    myPC.oniceconnectionstatechange = handleIceConnectionStateChange;
    myPC.onsignalingstatechange = handleSignalingStateChange;
}

/* Handles ICE candidate events */
function handleIceCandidate(event) {
    if (event.candidate) {
        wsChat.send(JSON.stringify({
            action: 'candidate',
            candidate: event.candidate,
            room: room
        }));
    }
}

/* Handles addition of a remote stream */
function handleRemoteStream(event) {
    const remoteStream = event.streams[0];
    document.getElementById("peerVid").srcObject = remoteStream;
}

/* Handles changes in ICE connection state */
function handleIceConnectionStateChange() {
    switch (myPC.iceConnectionState) {
        case 'disconnected':
        case 'failed':
            console.warn("ICE connection state failed or disconnected.");
            showSnackBar("Call connection problem", 15000);
            break;
        case 'closed':
            console.log("ICE connection state closed.");
            showSnackBar("Call connection closed", 15000);
            break;
    }
}

/* Handles changes in signaling state */
function handleSignalingStateChange() {
    if (myPC.signalingState === 'closed') {
        console.warn("Signaling state is 'closed'.");
        showSnackBar("Signal lost", 15000);
    }
}

/* Checks browser support for user media */
function checkUserMediaSupport() {
    return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
}

//get and set local media
function setLocalMedia(streamConstraints, isCaller){
    navigator.mediaDevices.getUserMedia(
        streamConstraints
    ).then(function(myStream){
        if (isUnsubscribed) {
            // Need to stop my stream
            myStream.getTracks().forEach((track) => track.stop());
            return;
        }
        
        document.getElementById("myVid").srcObject = myStream;
        
        //add my stream to RTCPeerConnection
        myStream.getTracks().forEach((track)=>{
            myPC.addTrack(track, myStream);
        });
        
        //set var myMediaStream as stream gotten. Will be used to remove stream later on
        myMediaStream = myStream;

        // Disable video track initially for owner
        if (isOwner) {
            const videoTrack = myMediaStream.getVideoTracks()[0];
            if (videoTrack) {
                videoTrack.enabled = false;
            }
        }
        
        if(isCaller){
            myPC.createOffer({
                offerToReceiveAudio: 1, // Explicitly request audio
                offerToReceiveVideo: 1  // Explicitly request video
            }).then(description, function(e){
                console.log("Error creating offer", e.message);
                
                showSnackBar("Call connection failed", 15000);
            });
            
            //then notify callee to start call on his end
            wsChat.send(JSON.stringify({
                action: 'startCall',
                isCaller: false,
                room: room
            }));
        }
        
        else{
            //myPC.createAnswer(description);
            myPC.createAnswer({
                offerToReceiveAudio: 1, // Explicitly request audio
                offerToReceiveVideo: 1  // Explicitly request video
            }).then(description).catch(function(e){
                console.log("Error creating answer", e);
                
                showSnackBar("Call connection failed", 15000);
            });

        }
        
    }).catch(function(e){
        
        switch(e.name){
            case 'SecurityError':
                console.log(e.message);
                
                showSnackBar("Media sources usage is not supported on this browser/device", 10000);
                break;

            case 'NotAllowedError':
                console.log(e.message);
                
                showSnackBar("We do not have access to your audio/video sources", 10000);
                break;
                
            case 'NotFoundError':
                console.log(e.message);
                
                showSnackBar("The requested audio/video source cannot be found", 10000);
                break;
            
            case 'NotReadableError':
            case 'AbortError':
                console.log(e.message);
                showSnackBar("Unable to use your media sources", 10000);
                break;
        }
    });
}

function description(desc){
    myPC.setLocalDescription(desc);

    //send sdp
    wsChat.send(JSON.stringify({
        action: 'sdp',
        sdp: desc,
        room: room
    }));
}

//set status of remote (online or offline)
function setRemoteStatus(status){
    if(status === 'online'){
        $("#remoteStatus").css('color', 'green');
        $("#remoteStatusTxt").css({color:'green'}).html("(Online)");
    }
    
    else{
        $("#remoteStatus").css('color', '');
        $("#remoteStatusTxt").css({color:'red'}).html("(Offline)");
    }
}

function startTimer() {
    let sec = 0; // Time in seconds
    let min = 0;
    let hr = 0;

    const hrElem = document.querySelector("#countHr");
    const minElem = document.querySelector("#countMin");
    const secElem = document.querySelector("#countSec");

    // Initialize timer
    hrElem.innerHTML = "00";
    minElem.innerHTML = "00";
    secElem.innerHTML = "00";

    // Start interval
    timerInterval = setInterval(() => {
        sec++;

        // Update seconds
        if (sec === 60) {
            sec = 0;
            min++;
        }

        // Update minutes
        if (min === 60) {
            min = 0;
            hr++;
        }

        // Display updated time
        hrElem.innerHTML = hr < 10 ? `0${hr}` : hr;
        minElem.innerHTML = min < 10 ? `0${min}` : min;
        secElem.innerHTML = sec < 10 ? `0${sec}` : sec;
    }, 1000);
}

function stopTimer() {
    if (timerInterval) {
        clearInterval(timerInterval); // Stop interval
        timerInterval = null; // Reset interval ID
    }
}

function showSnackBar(msg, displayTime){
    document.getElementById('snackbar').innerHTML = msg;
    document.getElementById('snackbar').className = document.getElementById('snackbar').getAttribute('class') + " show";
    
    setTimeout(function(){
        $("#snackbar").html("").removeClass("show");
    }, displayTime);
}

function endCall(){
    // Close peer connection
    if (myPC) {
        myPC.close();
        myPC = null; // Reset RTCPeerConnection object
    }

    stopTimer();

    // Stop local media stream
    stopMediaStream();

    // Clear video elements
    document.getElementById("myVid").srcObject = null; // Clear local video
    document.getElementById("peerVid").srcObject = null; // Clear remote video

    // Unsubscribe from room
    wsChat.send(JSON.stringify({
        action: 'unsubscribe',
        room: room
    }));
    isUnsubscribed = true

    // Disable buttons
    disableButtons();

    // Tell user that call ended
    showSnackBar("Call ended", 10000);
}

function endCallByRemote(){
    // Close peer connection
    if (myPC) {
        myPC.close();
        myPC = null; // Reset RTCPeerConnection object
    }

    // Stop local media stream
    stopMediaStream();

    // Clear video elements
    document.getElementById("myVid").srcObject = null; // Clear local video
    document.getElementById("peerVid").srcObject = null; // Clear remote video

    // Notify that call ended by remote
    showSnackBar("Call ended by remote", 10000);
}

function stopMediaStream(){    
    if (myMediaStream && myMediaStream.getTracks().length) {
        // Stop all tracks in media stream
        myMediaStream.getTracks().forEach((track) => track.stop());
    }
    myMediaStream = null; // Reset media stream variable
}

function toggleVideoStream() {
    if (!myMediaStream) {
        showSnackBar("Media stream not initialized", 5000);
        return;
    }

    const videoTrack = myMediaStream.getVideoTracks()[0];

    if (videoTrack) {
        // Turn off video by disabling track
        videoTrack.enabled = !videoTrack.enabled;

        // Update button UI based on track's state
        if (videoTrack.enabled) {
            toggleVideoButton.classList.add("btn-enabled");
            showSnackBar("Video enabled", 3000);
        } else {
            toggleVideoButton.classList.remove("btn-enabled");
            showSnackBar("Video disabled", 3000);
        }
    } else {
        // No video track exists; try to add one
        navigator.mediaDevices.getUserMedia({ video: true })
            .then((stream) => {
                const newVideoTrack = stream.getVideoTracks()[0];

                if (newVideoTrack) {
                    // Add new video track to myMediaStream
                    myMediaStream.addTrack(newVideoTrack);

                    // Replace video track in PeerConnection
                    const sender = myPC.getSenders().find(s => s.track && s.track.kind === "video");
                    if (sender) {
                        sender.replaceTrack(newVideoTrack);
                    } else {
                        myPC.addTrack(newVideoTrack, myMediaStream);
                    }

                    // Update button UI
                    toggleVideoButton.classList.add("btn-enabled");
                    showSnackBar("Video enabled", 3000);
                }
            })
            .catch((err) => {
                console.error("Error accessing video: ", err);
                showSnackBar("Unable to access video", 5000);
            });
    }
}

// Function to show video button for owner when call starts
function showVideoButtonForOwner() {
    if (isOwner) {
        toggleVideoButton.style.display = "inline-block"; // Show button
        endCallButton.style.margin = ""; // Reset margin for proper alignment of both buttons
    }
}

function disableButtons() {
    toggleVideoButton.disabled = true;
    endCallButton.disabled = true;
}
