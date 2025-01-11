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

// Event Listeners
window.addEventListener('load', initializeApplication);

function initializeApplication() {
    setupInitialLayout();
    startTimer();
    fetchAdditionalIceServers();
    initializeWebSocket();
    setupButtonEventListeners();
}

// Configures initial layout
function setupInitialLayout() {
    toggleVideoButton.style.display = "none"; // Hide video toggle
    endCallButton.style.margin = "auto"; // Center end call button

    if (isOwner) {
        localVideoElement.style.display = "none"; // Hide local video by default for owner
    } else {
        updateLayoutByRemoteVideo(false); // Full-screen local video by default for non-owner
    }
}

// Fetches additional ICE servers for fallback and adds them to default list
function fetchAdditionalIceServers() {
    fetch(`${appRoot}Server.php`)
        .then(response => response.json())
        .then(iceServers => {
            servers.iceServers = servers.iceServers.concat(iceServers);
        })
        .catch(error => console.error("Error fetching ICE servers:", error));
}

// Initializes WebSocket connection and sets up event handlers
function initializeWebSocket() {
    wsChat = new WebSocket(`${wsUrl}/`);

    wsChat.onopen = () => {
        // Subscribe to room
        wsChat.send(JSON.stringify({ action: 'subscribe', room, isOwner }));
        showSnackBar("Connected to WebSocket server!", 5000);
    };

    wsChat.onerror = () => {
        showSnackBar("Unable to connect to WebSocket server. Please refresh.", 20000);
    };

    wsChat.onmessage = handleWebSocketMessage;
}

// Handles incoming WebSocket messages
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
            case 'imOffline':
                handleRemoteOffline();
                break;
            case 'toggleVideo':
                console.log("here toggleVideo", data)
                updateLayoutByRemoteVideo(data.isVideoEnabled);
                break;
        }
    } else if (data.action === "subRejected") {
        showSnackBar(data.reason, 5000);
    }
}

function handleNewSubscriber() {
    showSnackBar("Remote joined room.", 10000);
}

function handleRemoteOffline() {
    endCallByRemote();
    showSnackBar("Remote left room.", 10000);

    if (isOwner) {
        // Update layout
        updateLayoutByLocalVideo(false);
    }
}

// Sets up event listeners for buttons
function setupButtonEventListeners() {
    endCallButton.addEventListener('click', () => {
        endCall();
    });

    if (isOwner) {
        toggleVideoButton.addEventListener('click', toggleVideoStream);
    }
}

// Extracts room and role from URL parameters and determines ownership
function getRoomAndOwnership() {
    const params = new URLSearchParams(window.location.search);
    const room = params.get("room") || "";
    const isOwner = params.get("role") === "owner"; // Determine ownership
    return { room, isOwner };
}

// Starts call
function startCall(isCaller) {
    if (isUnsubscribed) {
        console.warn("Cannot start call: User is unsubscribed.");
        return;
    }

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

// Initializes RTCPeerConnection and sets up event handlers
function initializePeerConnection() {
    myPC = new RTCPeerConnection(servers);

    myPC.onicecandidate = handleIceCandidate;
    myPC.ontrack = handleRemoteStream;
    myPC.oniceconnectionstatechange = handleIceConnectionStateChange;
    myPC.onsignalingstatechange = handleSignalingStateChange;
}

// Handles ICE candidate events
function handleIceCandidate(event) {
    if (event.candidate) {
        wsChat.send(JSON.stringify({
            action: 'candidate',
            candidate: event.candidate,
            room: room
        }));
    }
}

// Handles addition of a remote stream
function handleRemoteStream(event) {
    const remoteStream = event.streams[0];
    remoteVideoElement.srcObject = remoteStream;

    // Update layout
    // if (!isOwner) {
    //     updateRemoteVideoLayout();
    // }
}

// Handles changes in ICE connection state
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

// Handles changes in signaling state
function handleSignalingStateChange() {
    if (myPC.signalingState === 'closed') {
        console.warn("Signaling state is 'closed'.");
        showSnackBar("Signal lost", 15000);
    }
}

// Checks browser support for user media
function checkUserMediaSupport() {
    return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
}

// Get and set local media
function setLocalMedia(streamConstraints, isCaller) {
    navigator.mediaDevices.getUserMedia(streamConstraints)
        .then((myStream) => {
            if (isUnsubscribed) {
                // Stop tracks if unsubscribed
                myStream.getTracks().forEach((track) => track.stop());
                return;
            }

            // Attach stream to local video element
            localVideoElement.srcObject = myStream;

            // Add tracks to RTCPeerConnection
            myStream.getTracks().forEach((track) => myPC.addTrack(track, myStream));
            myMediaStream = myStream; // Save stream for later use

            // Disable video track for owner initially
            if (isOwner) {
                const videoTrack = myMediaStream.getVideoTracks()[0];
                if (videoTrack) videoTrack.enabled = false;
            }

            // Create offer or answer
            if (isCaller) {
                createOffer();
            } else {
                createAnswer();
            }
        })
        .catch(handleMediaError);
}

// Helper function to create offer
function createOffer() {
    myPC.createOffer({
        offerToReceiveAudio: 1, // Explicitly request audio
        offerToReceiveVideo: 1  // Explicitly request video
    }).then(description, function(e){
        console.log("Error creating offer", e.message);
        
        showSnackBar("Call connection failed", 15000);
    });
    
    // Notify callee to start call on his end
    wsChat.send(JSON.stringify({
        action: 'startCall',
        isCaller: false,
        room: room
    }));
}

// Helper function to create answer
function createAnswer() {
    myPC.createAnswer({
        offerToReceiveAudio: 1, // Explicitly request audio
        offerToReceiveVideo: 1  // Explicitly request video
    }).then(description).catch(function(e){
        console.log("Error creating answer", e);
        showSnackBar("Call connection failed", 15000);
    });
}

// Helper function to handle media access errors
function handleMediaError(error) {
    console.error("Media error:", error.message);
    const errorMessages = {
        SecurityError: "Media sources usage is not supported on this browser/device",
        NotAllowedError: "We do not have access to your audio/video sources",
        NotFoundError: "The requested audio/video source cannot be found",
        NotReadableError: "Unable to use your media sources",
        AbortError: "Unable to use your media sources"
    };
    showSnackBar(errorMessages[error.name] || "Media access error", 10000);
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
    // Close peer connection
    if (myPC) {
        myPC.close();
        myPC = null; // Reset RTCPeerConnection object
    }

    // Stop local media stream
    stopMediaStream();

    // Clear video elements
    localVideoElement.srcObject = null; // Clear local video
    remoteVideoElement.srcObject = null; // Clear remote video

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
        // Toggle video track state
        const isLocalVideoEnabled = !videoTrack.enabled;
        videoTrack.enabled = isLocalVideoEnabled;

        // Send toggle video signal
        wsChat.send(JSON.stringify({
            action: "toggleVideo",
            isVideoEnabled: isLocalVideoEnabled,
            room: room
        }));

        // Update layout
        updateLayoutByLocalVideo(isLocalVideoEnabled);
    }
}

// Updates layout by local video state
function updateLayoutByLocalVideo(isLocalVideoEnabled) {
    const icon = toggleVideoButton.querySelector("i");

    if (isLocalVideoEnabled) {
        icon.classList.remove("fa-video-slash");
        icon.classList.add("fa-video-camera");
        toggleVideoButton.classList.add("btn-enabled");
        localVideoElement.style.display = "block";
    } else {
        icon.classList.remove("fa-video-camera");
        icon.classList.add("fa-video-slash");
        toggleVideoButton.classList.remove("btn-enabled");
        localVideoElement.style.display = "none";
    }
}

// Updates layout by remote video state
function updateLayoutByRemoteVideo(isRemoteVideoEnabled) {
    if (!isRemoteVideoEnabled) {
        localVideoElement.classList.add("full-screen");
        remoteVideoElement.style.display = "none";
    } else {
        localVideoElement.classList.remove("full-screen");
        remoteVideoElement.style.display = "block";
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
