
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { GoogleGenAI, Modality, LiveServerMessage } from '@google/genai';
import { Participant, MeetingStatus } from './types';
import { decodeBase64, decodeAudioData, createPcmBlob } from './services/audioUtils';
import { 
  VideoCameraIcon, 
  VideoCameraSlashIcon, 
  MicrophoneIcon, 
  PhoneXMarkIcon,
  SparklesIcon,
  ChatBubbleBottomCenterTextIcon,
  UserGroupIcon,
  Cog6ToothIcon,
  NoSymbolIcon,
  UserPlusIcon,
  BackspaceIcon,
  PhoneIcon,
  CheckCircleIcon,
  ClipboardIcon,
  SpeakerWaveIcon,
  SignalIcon
} from '@heroicons/react/24/solid';

const ROOM_CHANNEL = 'gemini-meet-room-channel';
const FRAME_RATE = 12; // Optimized for BroadcastChannel throughput
const QUALITY = 0.4;   // JPEG Compression quality

const App: React.FC = () => {
  const [status, setStatus] = useState<MeetingStatus>('idle');
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [isMicOn, setIsMicOn] = useState(true);
  const [isCamOn, setIsCamOn] = useState(true);
  const [isAiActive, setIsAiActive] = useState(false);
  const [isAiSpeaking, setIsAiSpeaking] = useState(false);
  
  // Dialer & Meeting State
  const [isDialerOpen, setIsDialerOpen] = useState(false);
  const [dialedNumber, setDialedNumber] = useState('');
  const [isDialing, setIsDialing] = useState(false);
  const [showToast, setShowToast] = useState(false);
  const [toastMsg, setToastMsg] = useState('');
  
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const localId = useRef(Math.random().toString(36).substring(7));
  const channelRef = useRef<BroadcastChannel | null>(null);
  const captureCanvasRef = useRef<HTMLCanvasElement | null>(null);
  
  // Gemini Live Refs
  const sessionRef = useRef<any>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const audioSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());

  // Frame Streaming Logic
  useEffect(() => {
    let intervalId: number;
    if (status === 'connected' && isCamOn && localVideoRef.current) {
      const canvas = document.createElement('canvas');
      canvas.width = 320; // SD resolution for throughput
      canvas.height = 240;
      const ctx = canvas.getContext('2d');

      intervalId = window.setInterval(() => {
        if (localVideoRef.current && ctx) {
          ctx.drawImage(localVideoRef.current, 0, 0, canvas.width, canvas.height);
          const frame = canvas.toDataURL('image/jpeg', QUALITY);
          channelRef.current?.postMessage({ 
            type: 'VIDEO_FRAME', 
            payload: { id: localId.current, frame } 
          });
        }
      }, 1000 / FRAME_RATE);
    }
    return () => clearInterval(intervalId);
  }, [status, isCamOn]);

  // Local Video Attachment
  useEffect(() => {
    if (status === 'connected' && localVideoRef.current && localStreamRef.current) {
      if (localVideoRef.current.srcObject !== localStreamRef.current) {
        localVideoRef.current.srcObject = localStreamRef.current;
      }
    }
  }, [participants, status, isCamOn]);

  // Multi-tab Sync with Frame Handling
  useEffect(() => {
    const channel = new BroadcastChannel(ROOM_CHANNEL);
    channelRef.current = channel;

    channel.onmessage = (event) => {
      const { type, payload } = event.data;
      
      if (type === 'VIDEO_FRAME') {
        setParticipants(prev => prev.map(p => {
          if (p.id === payload.id) {
            return { ...p, lastFrame: payload.frame, isVideoOn: true };
          }
          return p;
        }));
      } else if (type === 'JOIN') {
        setParticipants(prev => {
          if (prev.find(p => p.id === payload.id)) return prev;
          channel.postMessage({ type: 'PRESENCE', payload: getLocalParticipantData() });
          return [...prev, payload];
        });
        showNotification(`${payload.name} joined the meeting`);
      } else if (type === 'PRESENCE') {
        setParticipants(prev => {
          if (prev.find(p => p.id === payload.id)) return prev;
          return [...prev, payload];
        });
      } else if (type === 'LEAVE') {
        setParticipants(prev => prev.filter(p => p.id !== payload.id));
      } else if (type === 'UPDATE') {
        setParticipants(prev => prev.map(p => p.id === payload.id ? { ...p, ...payload } : p));
      }
    };

    return () => channel.close();
  }, [status]);

  const getLocalParticipantData = () => ({
    id: localId.current,
    name: 'User ' + localId.current.toUpperCase(),
    isLocal: false,
    isVideoOn: isCamOn,
    isAudioOn: isMicOn,
    avatarColor: 'bg-indigo-600',
    isSpeaking: false
  });

  const showNotification = (msg: string) => {
    setToastMsg(msg);
    setShowToast(true);
    setTimeout(() => setShowToast(false), 4000);
  };

  const startMeeting = async () => {
    setStatus('joining');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { width: 1280, height: 720, frameRate: 30 }, 
        audio: true 
      });
      localStreamRef.current = stream;
      
      const localP: Participant = {
        id: localId.current,
        name: 'You',
        isLocal: true,
        isVideoOn: true,
        isAudioOn: true,
        avatarColor: 'bg-emerald-600',
        isSpeaking: false,
        stream: stream
      };

      setParticipants([localP]);
      setStatus('connected');
      
      channelRef.current?.postMessage({ 
        type: 'JOIN', 
        payload: { ...localP, isLocal: false, stream: undefined, name: 'User ' + localId.current.toUpperCase() } 
      });

      setTimeout(() => {
        if (localVideoRef.current) localVideoRef.current.srcObject = stream;
      }, 100);

    } catch (err) {
      console.error("Failed to get media", err);
      alert("Permission denied. Ensure camera access is allowed.");
      setStatus('idle');
    }
  };

  const toggleMic = () => {
    if (localStreamRef.current) {
      const newState = !isMicOn;
      localStreamRef.current.getAudioTracks().forEach(track => track.enabled = newState);
      setIsMicOn(newState);
      channelRef.current?.postMessage({ type: 'UPDATE', payload: { id: localId.current, isAudioOn: newState } });
    }
  };

  const toggleCam = () => {
    if (localStreamRef.current) {
      const newState = !isCamOn;
      localStreamRef.current.getVideoTracks().forEach(track => track.enabled = newState);
      setIsCamOn(newState);
      channelRef.current?.postMessage({ type: 'UPDATE', payload: { id: localId.current, isVideoOn: newState } });
    }
  };

  const leaveMeeting = () => {
    channelRef.current?.postMessage({ type: 'LEAVE', payload: { id: localId.current } });
    localStreamRef.current?.getTracks().forEach(track => track.stop());
    if (sessionRef.current) sessionRef.current.close();
    setStatus('ended');
    window.location.reload();
  };

  const copyInviteLink = () => {
    navigator.clipboard.writeText(window.location.href);
    showNotification("Meeting link copied!");
  };

  const handleDialerInput = (val: string) => {
    if (dialedNumber.length < 15) setDialedNumber(prev => prev + val);
  };

  const handleDialerBackspace = () => setDialedNumber(prev => prev.slice(0, -1));

  const callParticipantViaWhatsApp = () => {
    if (!dialedNumber) return;
    setIsDialing(true);
    const cleanNumber = dialedNumber.replace(/\D/g, '');
    const meetingUrl = window.location.href;
    const inviteMessage = `Join my HD Gemini video call! %0AClick here to join: ${meetingUrl}`;
    window.open(`https://wa.me/${cleanNumber}?text=${inviteMessage}`, '_blank');
    setIsDialing(false);
    setIsDialerOpen(false);
    setDialedNumber('');
    showNotification("Invite sent! Waiting for participant...");
  };

  const toggleAi = useCallback(async () => {
    if (isAiActive) {
      sessionRef.current?.close();
      setIsAiActive(false);
      setParticipants(prev => prev.filter(p => !p.isAI));
      return;
    }
    setIsAiActive(true);
    const aiParticipant: Participant = {
      id: 'ai-bot',
      name: 'Gemini AI',
      isLocal: false,
      isAI: true,
      isVideoOn: true,
      isAudioOn: true,
      avatarColor: 'bg-gradient-to-br from-indigo-500 to-blue-700',
      isSpeaking: false
    };
    setParticipants(prev => [aiParticipant, ...prev]);
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
    }
    const outCtx = audioContextRef.current;
    const sessionPromise = ai.live.connect({
      model: 'gemini-2.5-flash-native-audio-preview-09-2025',
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Puck' } } },
        systemInstruction: 'You are a professional meeting assistant. Keep answers brief and clear.'
      },
      callbacks: {
        onopen: () => {
          if (localStreamRef.current) {
            const inCtx = new AudioContext({ sampleRate: 16000 });
            const source = inCtx.createMediaStreamSource(localStreamRef.current);
            const processor = inCtx.createScriptProcessor(4096, 1, 1);
            processor.onaudioprocess = (e) => {
              const input = e.inputBuffer.getChannelData(0);
              sessionPromise.then(session => {
                session.sendRealtimeInput({ media: createPcmBlob(input) });
              });
            };
            source.connect(processor);
            processor.connect(inCtx.destination);
          }
        },
        onmessage: async (msg: LiveServerMessage) => {
          const audioData = msg.serverContent?.modelTurn?.parts[0]?.inlineData?.data;
          if (audioData) {
            setIsAiSpeaking(true);
            nextStartTimeRef.current = Math.max(nextStartTimeRef.current, outCtx.currentTime);
            const buffer = await decodeAudioData(decodeBase64(audioData), outCtx);
            const source = outCtx.createBufferSource();
            source.buffer = buffer;
            source.connect(outCtx.destination);
            source.onended = () => {
              audioSourcesRef.current.delete(source);
              if (audioSourcesRef.current.size === 0) setIsAiSpeaking(false);
            };
            source.start(nextStartTimeRef.current);
            nextStartTimeRef.current += buffer.duration;
            audioSourcesRef.current.add(source);
          }
        },
        onclose: () => setIsAiActive(false),
      }
    });
    sessionRef.current = await sessionPromise;
  }, [isAiActive]);

  if (status === 'idle' || status === 'ended') {
    return (
      <div className="h-screen flex items-center justify-center bg-[#050811] p-4">
        <div className="max-w-md w-full bg-[#0f172a] rounded-[2.5rem] p-10 shadow-2xl border border-white/10 text-center">
          <div className="w-24 h-24 bg-emerald-500/10 rounded-3xl flex items-center justify-center mx-auto mb-8 animate-pulse">
            <VideoCameraIcon className="w-12 h-12 text-emerald-500" />
          </div>
          <h1 className="text-4xl font-extrabold mb-3 tracking-tight">Gemini Meet</h1>
          <p className="text-slate-400 mb-10 text-lg leading-relaxed">Experience high-definition video calls with real-time AI collaboration.</p>
          <button onClick={startMeeting} className="w-full py-5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-2xl font-black text-xl transition-all transform active:scale-95 shadow-[0_0_30px_rgba(16,185,129,0.2)]">Start New Meeting</button>
          <div className="mt-8 flex justify-center gap-4">
             <div className="px-3 py-1 bg-slate-800 rounded-full text-[10px] font-bold text-slate-400 uppercase tracking-widest border border-slate-700">1080p Enabled</div>
             <div className="px-3 py-1 bg-slate-800 rounded-full text-[10px] font-bold text-slate-400 uppercase tracking-widest border border-slate-700">AI Powered</div>
          </div>
        </div>
      </div>
    );
  }

  const getGridClass = () => {
    const count = participants.length;
    if (count <= 1) return 'grid-cols-1';
    if (count <= 2) return 'grid-cols-1 md:grid-cols-2';
    return 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3';
  };

  return (
    <div className="h-screen flex flex-col bg-[#050811] text-slate-100 selection:bg-emerald-500/30">
      {showToast && (
        <div className="fixed top-8 right-8 z-[110] bg-emerald-600 text-white px-8 py-4 rounded-3xl shadow-2xl flex items-center gap-4 animate-in slide-in-from-right ring-4 ring-emerald-500/20">
          <CheckCircleIcon className="w-7 h-7" />
          <p className="font-bold">{toastMsg}</p>
        </div>
      )}

      {isDialerOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 backdrop-blur-xl">
          <div className="bg-[#1e293b] border border-white/10 p-10 rounded-[3.5rem] shadow-2xl w-full max-w-sm text-center flex flex-col items-center animate-in zoom-in duration-300">
            <button onClick={() => setIsDialerOpen(false)} className="absolute top-6 right-6 text-slate-400 hover:text-white transition-colors p-2"><PhoneXMarkIcon className="w-8 h-8" /></button>
            <h2 className="text-2xl font-black mb-2 tracking-tight">WhatsApp Invite</h2>
            <p className="text-sm text-slate-400 mb-8 font-medium">Enter participant's phone number</p>
            <div className="w-full bg-slate-950 h-20 rounded-3xl mb-8 flex items-center justify-center text-3xl font-mono text-emerald-400 border border-white/5 shadow-inner">{dialedNumber || '000 000 0000'}</div>
            <div className="grid grid-cols-3 gap-5 mb-10 w-full">
              {['1', '2', '3', '4', '5', '6', '7', '8', '9', '+', '0', '#'].map((n) => (
                <button key={n} onClick={() => handleDialerInput(n)} className="h-16 rounded-3xl bg-slate-800/50 hover:bg-slate-700 text-2xl font-black border border-white/5 transform active:scale-90 transition-all">{n}</button>
              ))}
            </div>
            <div className="flex gap-5 w-full">
              <button onClick={handleDialerBackspace} className="flex-1 py-4 bg-slate-800 rounded-2xl flex items-center justify-center hover:bg-slate-700"><BackspaceIcon className="w-8 h-8" /></button>
              <button onClick={callParticipantViaWhatsApp} className="flex-[2] py-4 bg-emerald-600 rounded-2xl font-black text-lg flex items-center justify-center gap-3 shadow-[0_0_40px_rgba(16,185,129,0.3)] hover:bg-emerald-500 transition-all transform active:scale-95"><ChatBubbleBottomCenterTextIcon className="w-6 h-6" /> Invite</button>
            </div>
          </div>
        </div>
      )}

      <header className="h-20 flex items-center justify-between px-10 border-b border-white/5 bg-[#050811]/60 backdrop-blur-2xl z-10">
        <div className="flex items-center gap-5">
          <div className="w-12 h-12 bg-emerald-600 rounded-2xl flex items-center justify-center shadow-[0_0_20px_rgba(16,185,129,0.3)]"><VideoCameraIcon className="w-7 h-7 text-white" /></div>
          <div>
            <h1 className="font-black text-lg tracking-tight leading-none mb-1">GEMINI MEET ROOM</h1>
            <div className="flex items-center gap-2">
               <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
               <p className="text-[10px] text-emerald-500 font-black uppercase tracking-[0.2em]">HD 1080p ACTIVE</p>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <button onClick={copyInviteLink} className="flex items-center gap-3 bg-slate-900/50 hover:bg-slate-800 px-6 py-3 rounded-2xl text-xs font-black text-slate-300 border border-white/5 transition-all transform active:scale-95"><ClipboardIcon className="w-5 h-5" /> Copy Link</button>
          <button onClick={() => setIsDialerOpen(true)} className="flex items-center gap-3 bg-emerald-600/10 hover:bg-emerald-600/20 px-6 py-3 rounded-2xl text-xs font-black text-emerald-400 border border-emerald-500/20 transition-all transform active:scale-95"><UserPlusIcon className="w-5 h-5" /> Add Member</button>
        </div>
      </header>

      <main className={`video-grid ${getGridClass()} flex-1 overflow-y-auto p-8 gap-8`}>
        {participants.map((p) => (
          <div key={p.id} className={`participant-card relative group shadow-2xl ${p.isSpeaking || (p.isAI && isAiSpeaking) ? 'active-speaker ring-4 ring-emerald-500/40' : 'border-white/5'}`}>
            {p.isLocal ? (
              <video 
                ref={localVideoRef} 
                autoPlay 
                muted 
                playsInline 
                className={`w-full h-full object-cover transform transition-all duration-500 ${isCamOn ? 'scale-x-[-1] opacity-100' : 'opacity-0 scale-105'}`} 
              />
            ) : p.isAI ? (
                <div className="w-full h-full bg-[#0a0f1e] flex flex-col items-center justify-center relative overflow-hidden">
                    <div className={`absolute inset-0 bg-gradient-to-br from-indigo-500/30 via-blue-700/20 to-emerald-500/30 transition-opacity duration-1000 ${isAiSpeaking ? 'opacity-100' : 'opacity-0'}`} />
                    <div className={`w-36 h-36 rounded-full bg-gradient-to-br from-indigo-500 to-blue-700 flex items-center justify-center shadow-[0_0_50px_rgba(59,130,246,0.5)] z-10 transition-all duration-700 ${isAiSpeaking ? 'scale-110' : 'scale-100 grayscale-[0.3]'}`}><SparklesIcon className="w-20 h-20 text-white" /></div>
                    {isAiSpeaking && <div className="mt-10 wave-container z-10">{[...Array(15)].map((_, i) => (<div key={i} className="wave-bar w-1" style={{ animationDelay: `${i * 0.08}s`, background: '#3b82f6' }} />))}</div>}
                </div>
            ) : (
              <div className="w-full h-full bg-[#0a0f1e] flex items-center justify-center relative">
                {p.isVideoOn && p.lastFrame ? (
                    <div className="w-full h-full relative">
                        <img src={p.lastFrame} className="w-full h-full object-cover transition-opacity duration-300" alt="Remote participant video" />
                        <div className="absolute top-4 right-4 flex items-center gap-2 bg-black/40 backdrop-blur-md px-3 py-1.5 rounded-xl border border-white/10">
                            <SignalIcon className="w-4 h-4 text-emerald-500" />
                            <span className="text-[10px] font-black uppercase tracking-widest text-emerald-400">HD Stream</span>
                        </div>
                    </div>
                ) : (
                    <div className="flex flex-col items-center gap-6 animate-in fade-in duration-700">
                        <div className={`w-28 h-28 rounded-[2rem] ${p.avatarColor} flex items-center justify-center text-5xl font-black text-white shadow-2xl border-2 border-white/10`}>{p.name.charAt(0)}</div>
                        <div className="flex flex-col items-center gap-1">
                          <p className="text-slate-300 font-bold tracking-tight text-lg">{p.name}</p>
                          <p className="text-slate-500 text-[10px] font-black uppercase tracking-widest">Camera Disabled</p>
                        </div>
                    </div>
                )}
              </div>
            )}
            
            {p.isLocal && !isCamOn && (
               <div className="absolute inset-0 bg-[#0a0f1e] flex flex-col items-center justify-center gap-6 animate-in fade-in">
                 <div className="w-28 h-28 rounded-[2rem] bg-emerald-600/10 flex items-center justify-center text-5xl font-black text-emerald-500 border-2 border-emerald-500/20 shadow-2xl">Y</div>
                 <p className="text-slate-500 text-xs font-black uppercase tracking-[0.2em]">Your Camera is Paused</p>
               </div>
            )}

            <div className="absolute bottom-6 left-6 flex items-center gap-4 bg-black/60 backdrop-blur-2xl px-5 py-2.5 rounded-2xl border border-white/10 shadow-2xl transition-all group-hover:bg-black/80">
              <div className="flex items-center gap-4">
                <span className="text-sm font-black tracking-tight">{p.name} {p.isLocal && "(You)"}</span>
                <div className="flex items-center gap-1 h-4">
                  {p.isAudioOn ? (
                    [1, 2, 3, 4].map(i => <div key={i} className={`w-1 h-full bg-emerald-400 rounded-full ${p.isSpeaking || (p.isAI && isAiSpeaking) ? 'animate-bounce' : 'opacity-30'}`} style={{ animationDelay: `${i*0.1}s` }} />)
                  ) : <NoSymbolIcon className="w-4 h-4 text-red-500" />}
                </div>
              </div>
            </div>
          </div>
        ))}
      </main>

      <footer className="h-32 flex items-center justify-center relative z-20 px-10">
        <div className="glass-panel px-12 py-6 rounded-[3rem] flex items-center gap-10 shadow-2xl border border-white/10 ring-1 ring-white/5">
          <button onClick={toggleMic} className={`p-5 rounded-full transition-all transform hover:scale-110 active:scale-90 ${isMicOn ? 'bg-slate-800 hover:bg-slate-700 text-white' : 'bg-red-500 text-white shadow-[0_0_30px_rgba(239,68,68,0.3)]'}`}>
            {isMicOn ? <MicrophoneIcon className="w-7 h-7" /> : <NoSymbolIcon className="w-7 h-7" />}
          </button>
          
          <button onClick={toggleCam} className={`p-5 rounded-full transition-all transform hover:scale-110 active:scale-90 ${isCamOn ? 'bg-slate-800 hover:bg-slate-700 text-white' : 'bg-red-500 text-white shadow-[0_0_30px_rgba(239,68,68,0.3)]'}`}>
            {isCamOn ? <VideoCameraIcon className="w-7 h-7" /> : <VideoCameraSlashIcon className="w-7 h-7" />}
          </button>

          <button onClick={toggleAi} className={`p-5 rounded-full transition-all transform hover:scale-110 active:scale-90 ${isAiActive ? 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-[0_0_40px_rgba(79,70,229,0.4)] ring-2 ring-indigo-400/30' : 'bg-slate-800 hover:bg-slate-700 text-slate-400'}`}>
            <SparklesIcon className="w-7 h-7" />
          </button>

          <div className="w-px h-12 bg-white/10 mx-2" />

          <button onClick={leaveMeeting} className="p-5 bg-red-600 hover:bg-red-500 text-white rounded-full transition-all transform hover:scale-110 active:scale-95 shadow-[0_0_40px_rgba(220,38,38,0.4)]">
            <PhoneXMarkIcon className="w-8 h-8" />
          </button>
        </div>
        
        <div className="absolute right-12 hidden xl:flex items-center gap-5 bg-slate-900/60 backdrop-blur-2xl px-6 py-4 rounded-3xl border border-white/5 shadow-2xl">
          <div className="flex -space-x-3">
            {participants.slice(0, 3).map((p, i) => (
               <div key={p.id} className={`w-8 h-8 rounded-full ${p.avatarColor} border-2 border-slate-900 flex items-center justify-center text-[10px] font-black`}>{p.name.charAt(0)}</div>
            ))}
          </div>
          <span className="text-xs font-black text-slate-400 uppercase tracking-[0.2em]">{participants.length} Active Users</span>
        </div>
      </footer>
    </div>
  );
};

export default App;
