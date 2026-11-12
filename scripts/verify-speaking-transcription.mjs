import assert from 'node:assert/strict';
import {ExamAudio} from '../modules/speaking/dist/audio.js';

const names=['navigator','MediaRecorder','SpeechRecognition','webkitSpeechRecognition','AudioContext','webkitAudioContext'];
const saved=new Map(names.map(name=>[name,Object.getOwnPropertyDescriptor(globalThis,name)]));
const set=(name,value)=>Object.defineProperty(globalThis,name,{configurable:true,writable:true,value});
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let current,starts=0,noStopEvent=false;
class Recognition {
 constructor(){current=this;}
 start(){starts++;this.onstart?.();}
 stop(){if(!noStopEvent)this.onend?.();}
 abort(){}
 result(text,isFinal){const result=[{transcript:text}];result.isFinal=isFinal;this.onresult?.({results:[result],resultIndex:0});}
}
class Recorder {
 static isTypeSupported(){return true;}
 constructor(){this.state='inactive';this.mimeType='audio/webm';}
 start(){this.state='recording';}
 stop(){this.state='inactive';queueMicrotask(()=>{this.ondataavailable?.({data:new Blob(['a-real-local-capture-fixture'])});void this.onstop?.();});}
}
try{
 set('navigator',{mediaDevices:{async getUserMedia(){const track=new EventTarget();track.stop=()=>{};return {getTracks:()=>[track],getAudioTracks:()=>[track]};}}});
 set('MediaRecorder',Recorder);set('SpeechRecognition',Recognition);set('webkitSpeechRecognition',undefined);set('AudioContext',undefined);set('webkitAudioContext',undefined);
 const audio=new ExamAudio(),text=[];await audio.start({transcribe:true,onTranscript:value=>text.push(value)});
 current.result('I enjoy art',false);current.result('I enjoy art exhibitions.',true);current.onend();await wait(280);
 assert.equal(starts,2);current.result('They help me understand history.',true);
 const first=await audio.stop();assert.equal(first.transcript,'I enjoy art exhibitions. They help me understand history.');assert(!first.transcript.includes('I enjoy art I enjoy'));
 assert(first.blob.size>0);assert.equal(first.transcriptStatus,'available');console.log('PASS recognition final/interim replacement avoids duplication; service restart preserves earlier transcript');
 starts=0;const notices=[];const empty=new ExamAudio();await empty.start({transcribe:true,onError:error=>notices.push(error.message)});
 for(let cycle=0;cycle<3;cycle++){current.onerror?.({error:'no-speech'});current.onend?.();await wait(cycle<2?1000:1600);}
 const boundedStarts=starts;await wait(1700);assert.equal(starts,boundedStarts);assert(starts<=3);assert(empty.recording);assert.equal(notices.length,1);assert((await empty.stop()).blob.size>0);
 console.log('PASS empty recognition cycles stop restarting after a bounded budget; audio recording and save remain usable');
 const failed=new ExamAudio();await failed.start({transcribe:true});current.onerror({error:'network'});assert(failed.recording);const before=starts;await wait(1700);assert.equal(starts,before);assert.equal((await failed.stop()).transcriptStatus,'unavailable');
 console.log('PASS recognition network failure never triggers unbounded retries or discards microphone recording');
 noStopEvent=true;const stalled=new ExamAudio();await stalled.start({transcribe:true});current.result('This partial text stays available.',false);const began=Date.now(),last=await stalled.stop();assert(Date.now()-began<1500);assert(last.blob.size>0);assert.equal(last.transcript,'This partial text stays available.');assert.equal(last.transcriptStatus,'partial');
 console.log('PASS a stalled recognition stop cannot block recording delivery; partial transcript remains accurately marked');
}finally{for(const [name,descriptor] of saved){if(descriptor)Object.defineProperty(globalThis,name,descriptor);else delete globalThis[name];}}
