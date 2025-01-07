'use strict';

var servers = {
    iceServers: []
};

var myPC;
var awaitingResponse;
var streamConstraints;
var myMediaStream;
let wsChat;
var recordedChunks = [];
var mediaRecorder = null;

const { room, type } = getRoomAndType();

window.addEventListener('load', function(){
    wsChat = new WebSocket(`${wsUrl}/comm`);

    startCounter();//shows the time spent in room

    //Get ice servers
    let xhr = new XMLHttpRequest();

    xhr.onreadystatechange = function(e){
        if(xhr.readyState == 4 && xhr.status == 200){
            let iceServers = JSON.parse(xhr.responseText);

            servers.iceServers = [iceServers];
        }
    }

    xhr.open("GET", appRoot+"Server.php", true);
    xhr.send();
    
    wsChat.onopen = function(){
        //subscribe to room
        wsChat.send(JSON.stringify({
            action: 'subscribe',
            room: room
        }));
        
        showSnackBar("Connected to the ws server!", 5000);

        // Automatically start call if type is specified
        if (type) {
            streamConstraints = type === "video" ? { video: { facingMode: 'user' }, audio: true } : { audio: true };
            startCall(true); // Start the call as the initiator
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
                    startCall(false);//to start call when callee gives the go ahead (i.e. answers call)
                    
                    document.getElementById("callModal").style.display = 'none';//hide call modal
                    
                    clearTimeout(awaitingResponse);//clear timeout
                    
                    //stop tone
                    document.getElementById('callerTone').pause();
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
        
                    showSnackBar("Remote left room", 10000);
                    enableCallBtns();
                    break;
            }  
        }
        
        else if(data.action === "subRejected"){
            //subscription on this device rejected cos user has subscribed on another device/browser
            showSnackBar("Maximum of two users allowed in room. Communication disallowed", 5000);
        }
    };

    //WHEN USER CLICKS BTN TO ANSWER CALL
    //add event listener to the answer call buttons
    var answerCallElems = document.getElementsByClassName('answerCall');
    
    for (var i = 0; i < answerCallElems.length; i++) {
        answerCallElems[i].addEventListener('click', answerCall);
    }
    
    document.getElementById('record').addEventListener('click', (e)=>{
        if(myMediaStream && myMediaStream.getTracks().length){
            if(mediaRecorder && mediaRecorder.state == 'recording'){
                //stop recording
                mediaRecorder.stop();

                e.setAttribute('title', 'Record');
                e.target.classList.remove('btn-danger');
            }

            else{
                //start recording
                mediaRecorder = new MediaRecorder(myMediaStream, {
                    mimeType: 'video/webm;codecs=vp9'
                });
    
                mediaRecorder.start(1000);

                //change the button to reflect that recording has started
                e.setAttribute('title', 'Stop recording');
                e.target.classList.add('btn-danger');
    
                mediaRecorder.ondataavailable = function(e){
                    recordedChunks.push(e.data);
                }
    
                mediaRecorder.onstop = function(){
                    saveRecordedStream(recordedChunks);
    
                    setTimeout(()=>{
                        recordedChunks = [];
                    }, 3000);
                }
    
                mediaRecorder.onerror = function(e){
                    console.error(e);
                }
            }
        }

        else{
            showSnackBar('Nothing to record', 5000);
        }
    });
});


function getRoomAndType() {
    const params = new URLSearchParams(window.location.search);
    const room = params.get("room") || "";
    const type = params.get("type") || "";
    return { room, type };
}

function answerCall(){
    //check whether user can use webrtc and use that to determine the response to send
    if(checkUserMediaSupport){
        //set media constraints based on the button clicked. Audio only should be initiated by default
        streamConstraints = this.id === 'startVideo' ? {video:{facingMode:'user'}, audio:true} : {audio:true};

        //show msg that we're setting up call (i.e. locating servers)
        document.getElementById("calleeInfo").innerHTML = "<i class='"+spinnerClass+"'></i> Setting up call...";

        //uncomment the lines below if you comment out the get request above
        startCall(true);

        //dismiss modal
        document.getElementById("rcivModal").style.display = 'none';

        //enable the terminateCall btn
        disableCallBtns();

    }

    else{
        //inform caller and current user (i.e. receiver) that he cannot use webrtc, then dismiss modal after a while
        wsChat.send(JSON.stringify({
            action: 'callRejected',
            msg: "Remote's device does not have the necessary requirements to make call",
            room: room
        }));

        document.getElementById("calleeInfo").innerHTML = "Your browser/device does not meet the minimum requirements needed to make a call";

        setTimeout(function(){
            document.getElementById("rcivModal").style.display = 'none';
        }, 3000);
    }

    document.getElementById('callerTone').pause();
}

function startCall(isCaller){
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
        document.getElementById("myVid").srcObject = myStream;
        
        // myPC.addStream(myStream);//add my stream to RTCPeerConnection
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

function enableCallBtns(){
    //enable dial btns and disable endcall btn
    var initCallElems = document.getElementsByClassName('initCall');
    
    for(let i = 0; i < initCallElems.length; i++){
        initCallElems[i].removeAttribute('disabled');
    }
    
    document.getElementById('terminateCall').setAttribute('disabled', true);
    document.getElementById('record').setAttribute('disabled', true);
}

function disableCallBtns(){
    //disable dial btns and enable endall btn
    var initCallElems = document.getElementsByClassName('initCall');
    
    for(let i = 0; i < initCallElems.length; i++){
        initCallElems[i].setAttribute('disabled', true);
    }
    
    document.getElementById('terminateCall').removeAttribute('disabled');
    document.getElementById('record').removeAttribute('disabled');
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

function startCounter(){
    var sec = "00";
    var min = "00";
    var hr = "00";
    
    var hrElem = document.querySelector("#countHr");
    var minElem = document.querySelector("#countMin");
    var secElem = document.querySelector("#countSec");
    
    hrElem.innerHTML = hr;
    minElem.innerHTML = min;
    secElem.innerHTML = sec;
        
    setInterval(function(){
        //display seconds and increment it by a sec
        ++sec;
        
        secElem.innerHTML = sec >= 60 ? "00" : (sec < 10 ? "0"+sec : sec);
        
        if(sec >= 60){
            //increase minute and reset secs to 00
            ++min;
            minElem.innerHTML = min < 10 ? "0"+min : min;
            
            sec = 0;
            
            if(min >= 60){
                //increase hr by one and reset min to 00
                ++hr;
                hrElem.innerHTML = hr < 10 ? "0"+hr : hr;
                
                min = 0;
            }
        }
        
    }, 1000);
}

function showSnackBar(msg, displayTime){
    document.getElementById('snackbar').innerHTML = msg;
    document.getElementById('snackbar').className = document.getElementById('snackbar').getAttribute('class') + " show";
    
    setTimeout(function(){
        $("#snackbar").html("").removeClass("show");
    }, displayTime);
}

function saveRecordedStream(chunk){
    let blob = new Blob(chunk, {type:'video/webm'});

    let file = new File([blob], `__${moment().unix()}-record.webm`);

    saveAs(file);
}
