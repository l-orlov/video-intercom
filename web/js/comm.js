'use strict';

const servers = {
    iceServers: []
};

let myPC;
let awaitingResponse;
let streamConstraints;
let myMediaStream;
let wsChat;
let recordedChunks = [];
let mediaRecorder = null;

let isUnsubscribed = false; // If true can not start call
let timerInterval = null; // Global variable to store timer ID

const { room, type } = getRoomAndType();

window.addEventListener('load', function(){
    wsChat = new WebSocket(`${wsUrl}/`);

    startTimer();//shows the time spent in room

    //Get ice servers
    fetch(`${appRoot}Server.php`)
        .then(response => response.json())
        .then(iceServers => {
            servers.iceServers = [iceServers];
        })
        .catch(error => console.error("Error fetching ICE servers:", error));
    
    wsChat.onopen = function(){
        //subscribe to room
        wsChat.send(JSON.stringify({
            action: 'subscribe',
            room: room
        }));
        
        showSnackBar("Connected to the ws server!", 5000);

        if (type) {
            streamConstraints = type === "video" ? { video: { facingMode: 'user' }, audio: true } : { audio: true };
        }
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
                    setRemoteStatus('online');

                    //once the other user joined and current user has been notified, current user should also send a signal
                    //that he is online
                    wsChat.send(JSON.stringify({
                        action: 'imOnline',
                        room: room
                    }));

                    showSnackBar("Remote entered room", 10000);
                    
                    break;
                    
                case 'imOnline':
                    setRemoteStatus('online');
                    break;
                    
                case 'imOffline':
                    setRemoteStatus('offline');
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
    document.getElementById("endCall").addEventListener('click', function(e){
        e.preventDefault();

        // Disable the button
        const endCallButton = document.getElementById("endCall");
        endCallButton.disabled = true;

        endCall();
    });
});


function getRoomAndType() {
    const params = new URLSearchParams(window.location.search);
    const room = params.get("room") || "";
    const type = params.get("type") || "";
    return { room, type };
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
            document.getElementById("peerVid").srcObject = stream;
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
        
        document.getElementById("myVid").srcObject = myStream;
        
        //add my stream to RTCPeerConnection
        myStream.getTracks().forEach((track)=>{
            myPC.addTrack(track, myStream);
        });
        
        //set var myMediaStream as the stream gotten. Will be used to remove stream later on
        myMediaStream = myStream;
        
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

/**
 * 
 * @param {type} desc
 * @returns {undefined}
 */
function description(desc){
    myPC.setLocalDescription(desc);

    //send sdp
    wsChat.send(JSON.stringify({
        action: 'sdp',
        sdp: desc,
        room: room
    }));
}

//set the status of remote (online or offline)
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
    document.getElementById("myVid").srcObject = null; // Clear local video
    document.getElementById("peerVid").srcObject = null; // Clear remote video

    // Unsubscribe from room
    wsChat.send(JSON.stringify({
        action: 'unsubscribe',
        room: room
    }));
    isUnsubscribed = true

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
    document.getElementById("myVid").srcObject = null; // Clear local video
    document.getElementById("peerVid").srcObject = null; // Clear remote video

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
