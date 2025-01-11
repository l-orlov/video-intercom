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

// Buttons for call control
const toggleVideoButton = document.getElementById("toggle-video"); // Button to toggle video on/off
const endCallButton = document.getElementById("end-call"); // Button to end video call
// Video elements
const localVideoElement = document.getElementById("video-local"); // Local video stream element
const remoteVideoElement = document.getElementById("video-remote"); // Remote video stream element

// Get room and ownership from query parameters
const { room, isOwner } = getRoomAndOwnership();

window.addEventListener('load', function(){
    // Initially show only the "End Call" button
    toggleVideoButton.style.display = "none";
    endCallButton.style.margin = "auto"; // Center the "End Call" button

    wsChat = new WebSocket(`${wsUrl}/`);

    startTimer();//shows the time spent in room

    // Fetch additional ICE servers for fallback and add to default servers
    fetch(`${appRoot}Server.php`)
        .then(response => response.json())
        .then(iceServers => {
            servers.iceServers = servers.iceServers.concat(iceServers);
        })
        .catch(error => console.error("Error fetching ICE servers:", error));

    wsChat.onopen = function(){
        //subscribe to room
        wsChat.send(JSON.stringify({
            action: 'subscribe',
            room: room,
            isOwner: isOwner
        }));
        
        showSnackBar("Connected to the ws server!", 5000);
    };
    
    wsChat.onerror = function(){
        showSnackBar("Unable to connect to the ws server! Kindly refresh", 20000);
    };
    
    wsChat.onmessage = function(e){
        var data = JSON.parse(e.data);

        if(data.room === room){
            //above check is not necessary since all messages coming to this user are for the user's current room
            //but just to be on the safe side
            switch(data.action){
                case 'startCall':
                    // start call by message from server
                    const { isCaller } = data;
                    startCall(isCaller);
                    break;

                case 'candidate':
                    //message is iceCandidate
                    myPC ? myPC.addIceCandidate(new RTCIceCandidate(data.candidate)) : "";
                    break;

                case 'sdp':
                    //message is signal description
                    myPC ? myPC.setRemoteDescription(new RTCSessionDescription(data.sdp)) : "";
                    break;
                    
                case 'newSub':
                    showSnackBar("Remote entered room", 10000);
                    break;
                    
                case 'imOffline':
                    // Show message
                    showSnackBar("Remote left room", 10000);
                    // End call by remote
                    endCallByRemote();
                    break;
            }  
        }
        
        else if(data.action === "subRejected"){
            //subscription on this device rejected cos user has subscribed on another device/browser
            showSnackBar("Maximum of two users allowed in room. Communication disallowed", 5000);
        }
    };

    // On click end call
    document.getElementById("end-call").addEventListener('click', function(e){
        e.preventDefault();
        endCall();
    });

    // On click toggle video for owner
    if (isOwner) {
        document.getElementById("toggle-video").addEventListener("click", function () {
            toggleVideoStream();
        });
    }
});

// Extracts room and role from URL parameters and determines ownership
function getRoomAndOwnership() {
    const params = new URLSearchParams(window.location.search);
    const room = params.get("room") || "";
    const isOwner = params.get("role") === "owner"; // Determine ownership
    return { room, isOwner };
}

function startCall(isCaller){
    if (isUnsubscribed) {
        // Can not start call
        return
    }

    if(checkUserMediaSupport){
        myPC = new RTCPeerConnection(servers);//RTCPeerconnection obj
        
        //When my ice candidates become available
        myPC.onicecandidate = function(e){
            if(e.candidate){
                //send my candidate to peer
                wsChat.send(JSON.stringify({
                    action: 'candidate',
                    candidate: e.candidate,
                    room: room
                }));
            }
        };
    
        //When remote stream becomes available
        myPC.ontrack = function(e){
            const stream = e.streams[0];
            remoteVideoElement.srcObject = stream;
        };
        
        //when remote connection state and ice agent is closed
        myPC.oniceconnectionstatechange = function(){
            switch(myPC.iceConnectionState){
                case 'disconnected':
                case 'failed':
                    console.log("Ice connection state is failed/disconnected");
                    showSnackBar("Call connection problem", 15000);
                    break;
                    
                case 'closed':
                    console.log("Ice connection state is 'closed'");
                    showSnackBar("Call connection closed", 15000);
                    break;
            }
        };
        
        
        //WHEN REMOTE CLOSES CONNECTION
        myPC.onsignalingstatechange = function(){
            switch(myPC.signalingState){
                case 'closed':
                    console.log("Signalling state is 'closed'");
                    showSnackBar("Signal lost", 15000);
                    break;
            }
        };
        
        //set local media
        setLocalMedia(streamConstraints, isCaller);

        // Show video button for owner
        if (isOwner) {
            showVideoButtonForOwner();
        }
    }
    
    else{
        showSnackBar("Your browser does not support video call", 30000);
    }
}

function checkUserMediaSupport(){
    return !!(navigator.getUserMedia || navigator.webkitGetUserMedia || navigator.mozGetUserMedia || navigator.msGetUserMedia);
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
        
        localVideoElement.srcObject = myStream;
        
        //add my stream to RTCPeerConnection
        myStream.getTracks().forEach((track)=>{
            myPC.addTrack(track, myStream);
        });
        
        //set var myMediaStream as the stream gotten. Will be used to remove stream later on
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

    // Start the interval
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
        clearInterval(timerInterval); // Stop the interval
        timerInterval = null; // Reset the interval ID
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
    // Close the peer connection
    if (myPC) {
        myPC.close();
        myPC = null; // Reset the RTCPeerConnection object
    }

    // Stop the timer
    stopTimer();

    // Stop the local media stream
    stopMediaStream();

    // Clear video elements
    localVideoElement.srcObject = null; // Clear local video
    remoteVideoElement.srcObject = null; // Clear remote video

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
    // Close the peer connection
    if (myPC) {
        myPC.close();
        myPC = null; // Reset the RTCPeerConnection object
    }

    // Stop the local media stream
    stopMediaStream();

    // Clear video elements
    localVideoElement.srcObject = null; // Clear local video
    remoteVideoElement.srcObject = null; // Clear remote video

    // Notify that call ended by remote
    showSnackBar("Call ended by remote", 10000);
}

function stopMediaStream(){    
    if (myMediaStream && myMediaStream.getTracks().length) {
        // Stop all tracks in the media stream
        myMediaStream.getTracks().forEach((track) => track.stop());
    }
    myMediaStream = null; // Reset the media stream variable
}

function toggleVideoStream() {
    if (!myMediaStream) {
        showSnackBar("Media stream not initialized", 5000);
        return;
    }

    const videoTrack = myMediaStream.getVideoTracks()[0];

    if (videoTrack) {
        // Turn off video by disabling the track
        videoTrack.enabled = !videoTrack.enabled;

        // Update button UI based on the track's state
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
                    // Add the new video track to myMediaStream
                    myMediaStream.addTrack(newVideoTrack);

                    // Replace the video track in the PeerConnection
                    const sender = myPC.getSenders().find(s => s.track && s.track.kind === "video");
                    if (sender) {
                        sender.replaceTrack(newVideoTrack);
                    } else {
                        myPC.addTrack(newVideoTrack, myMediaStream);
                    }

                    // Update the button UI
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

// Function to show the video button for owner when call starts
function showVideoButtonForOwner() {
    if (isOwner) {
        toggleVideoButton.style.display = "inline-block"; // Show the button
        endCallButton.style.margin = ""; // Reset margin for proper alignment of both buttons
    }
}

function disableButtons() {
    toggleVideoButton.disabled = true;
    endCallButton.disabled = true;
}
