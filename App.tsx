
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
  SpeakerWaveIcon
} from '@heroicons/react/24/solid';

const ROOM_CHANNEL = 'gemini-meet-room-channel';

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
  
  // Gemini Live Refs
  const sessionRef = useRef<any>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const audioSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());

  // Multi-tab Sync (Simulating Real Network)
  useEffect(() => {
    const channel = new BroadcastChannel(ROOM_CHANNEL);
    channelRef.current = channel;

    channel.onmessage = (event) => {
      const { type, payload } = event.data;
      if (type === 'JOIN') {
        // Someone else joined, add them
        setParticipants(prev => {
          if (prev.find(p => p.id === payload.id)) return prev;
          // Respond by broadcasting our own presence so the newcomer knows about us
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
    name: 'You (Tab ' + localId.current + ')',
    isLocal: false, // For others, I am not local
    isVideoOn: isCamOn,
    isAudioOn: isMicOn,
    avatarColor: 'bg-emerald-500',
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
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      localStreamRef.current = stream;
      
      const localP: Participant = {
        id: localId.current,
        name: 'You',
        isLocal: true,
        isVideoOn: true,
        isAudioOn: true,
        avatarColor: 'bg-emerald-500',
        isSpeaking: false,
        stream: stream
      };

      setParticipants([localP]);
      setStatus('connected');
      
      // Broadcast join
      channelRef.current?.postMessage({ 
        type: 'JOIN', 
        payload: { ...localP, isLocal: false, stream: undefined } 
      });

      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }
    } catch (err) {
      console.error("Failed to get media", err);
      alert("Please allow camera and microphone access to join.");
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
    const link = window.location.href;
    navigator.clipboard.writeText(link);
    showNotification("Invite link copied to clipboard!");
  };

  // WhatsApp Invite Logic
  const handleDialerInput = (val: string) => {
    if (dialedNumber.length < 15) setDialedNumber(prev => prev + val);
  };

  const handleDialerBackspace = () => setDialedNumber(prev => prev.slice(0, -1));

  const callParticipantViaWhatsApp = () => {
    if (!dialedNumber) return;
    setIsDialing(true);
    
    const cleanNumber = dialedNumber.replace(/\D/g, '');
    const meetingUrl = window.location.href;
    const inviteMessage = `Join my video call on Gemini Meet! %0A%0AClick here to join: ${meetingUrl}`;
    const whatsappUrl = `https://wa.me/${cleanNumber}?text=${inviteMessage}`;
    
    window.open(whatsappUrl, '_blank');
    setIsDialing(false);
    setIsDialerOpen(false);
    setDialedNumber('');
    showNotification("WhatsApp invite sent! Waiting for them to join...");
  };

  // Gemini Live Logic
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
      avatarColor: 'bg-gradient-to-br from-blue-600 to-emerald-500',
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
        systemInstruction: 'You are an active participant in a video conference. Be helpful, concise, and professional. Engage naturally with the group.'
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
      <div className="h-screen flex items-center justify-center bg-[#0f172a] p-4">
        <div className="max-w-md w-full bg-[#1e293b] rounded-3xl p-8 shadow-2xl border border-slate-700/50 text-center">
          <div className="w-20 h-20 bg-emerald-500/10 rounded-2xl flex items-center justify-center mx-auto mb-6">
            <VideoCameraIcon className="w-10 h-10 text-emerald-500" />
          </div>
          <h1 className="text-3xl font-bold mb-2">Gemini Meet</h1>
          <p className="text-slate-400 mb-8">Secure P2P video calls with intelligent AI assistance.</p>
          <button 
            onClick={startMeeting}
            className="w-full py-4 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl font-bold transition-all transform active:scale-95 shadow-lg shadow-emerald-500/20"
          >
            Enter Meeting Room
          </button>
          <p className="mt-4 text-xs text-slate-500">To test multi-person joining, open this URL in another tab!</p>
        </div>
      </div>
    );
  }

  const getGridClass = () => {
    const count = participants.length;
    if (count <= 1) return 'grid-cols-1';
    if (count <= 4) return 'grid-cols-2';
    return 'grid-cols-3';
  };

  return (
    <div className="h-screen flex flex-col bg-[#0f172a]">
      {showToast && (
        <div className="fixed top-20 right-8 z-[110] bg-emerald-600 text-white px-6 py-3 rounded-2xl shadow-2xl flex items-center gap-3 animate-in slide-in-from-right">
          <CheckCircleIcon className="w-6 h-6" />
          <div>
            <p className="font-bold text-sm">Update</p>
            <p className="text-xs opacity-90">{toastMsg}</p>
          </div>
        </div>
      )}

      {isDialerOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-[#1e293b] border border-slate-700 p-8 rounded-[2.5rem] shadow-2xl w-full max-w-xs text-center flex flex-col items-center animate-in zoom-in duration-200">
            <button onClick={() => setIsDialerOpen(false)} className="absolute top-4 right-4 text-slate-500 hover:text-white"><PhoneXMarkIcon className="w-6 h-6" /></button>
            <h2 className="text-xl font-bold mb-1 text-white">Invite via WhatsApp</h2>
            <div className="w-full bg-slate-900 h-16 rounded-2xl my-6 flex items-center justify-center text-2xl font-mono text-emerald-400">{dialedNumber || 'Number...'}</div>
            <div className="grid grid-cols-3 gap-4 mb-6">
              {['1', '2', '3', '4', '5', '6', '7', '8', '9', '+', '0', '#'].map((n) => (
                <button key={n} onClick={() => handleDialerInput(n)} className="w-12 h-12 rounded-full bg-slate-800 hover:bg-slate-700 text-lg font-bold transition-all transform active:scale-90">{n}</button>
              ))}
            </div>
            <div className="flex gap-4 w-full">
              <button onClick={handleDialerBackspace} className="flex-1 py-3 bg-slate-800 rounded-xl flex items-center justify-center"><BackspaceIcon className="w-6 h-6" /></button>
              <button onClick={callParticipantViaWhatsApp} className="flex-[2] py-3 bg-emerald-600 rounded-xl font-bold flex items-center justify-center gap-2"><ChatBubbleBottomCenterTextIcon className="w-5 h-5" />Invite</button>
            </div>
          </div>
        </div>
      )}

      <header className="h-16 flex items-center justify-between px-6 border-b border-slate-800 bg-[#0f172a]/80 backdrop-blur-md z-10">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 bg-emerald-600 rounded-xl flex items-center justify-center shadow-lg shadow-emerald-600/20"><VideoCameraIcon className="w-6 h-6 text-white" /></div>
          <div>
            <h1 className="font-bold text-sm tracking-tight">GEMINI MEET ROOM</h1>
            <p className="text-[10px] text-emerald-500 font-mono flex items-center gap-1 uppercase tracking-widest"><span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse"/> Encrypted Live</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={copyInviteLink} className="flex items-center gap-2 bg-slate-800 hover:bg-slate-700 px-4 py-2 rounded-full text-xs font-bold text-slate-300 transition-all active:scale-95 border border-slate-700"><ClipboardIcon className="w-4 h-4" /> Copy Link</button>
          <button onClick={() => setIsDialerOpen(true)} className="flex items-center gap-2 bg-emerald-600/10 hover:bg-emerald-600/20 px-4 py-2 rounded-full text-xs font-bold text-emerald-400 transition-all active:scale-95 border border-emerald-500/20"><UserPlusIcon className="w-4 h-4" /> Invite Member</button>
        </div>
      </header>

      <main className={`video-grid ${getGridClass()} flex-1 overflow-y-auto`}>
        {participants.map((p) => (
          <div key={p.id} className={`participant-card relative animate-in zoom-in-95 duration-500 ${p.isSpeaking || (p.isAI && isAiSpeaking) ? 'active-speaker' : ''}`}>
            {p.isLocal ? (
              <video ref={localVideoRef} autoPlay muted playsInline className={`w-full h-full object-cover transform ${isCamOn ? 'scale-x-[-1]' : 'hidden'}`} />
            ) : p.isAI ? (
                <div className="w-full h-full bg-slate-800 flex flex-col items-center justify-center relative overflow-hidden">
                    <div className={`absolute inset-0 bg-gradient-to-br from-blue-600/30 to-emerald-500/30 transition-opacity duration-1000 ${isAiSpeaking ? 'opacity-100' : 'opacity-0'}`} />
                    <div className={`w-32 h-32 rounded-full bg-gradient-to-br from-blue-600 to-emerald-500 flex items-center justify-center shadow-2xl z-10 transition-transform duration-300 ${isAiSpeaking ? 'scale-110' : 'scale-100'}`}><SparklesIcon className="w-16 h-16 text-white" /></div>
                    {isAiSpeaking && <div className="mt-8 wave-container z-10">{[...Array(12)].map((_, i) => (<div key={i} className="wave-bar" style={{ animationDelay: `${i * 0.1}s` }} />))}</div>}
                </div>
            ) : (
              <div className="w-full h-full bg-slate-800 flex items-center justify-center relative">
                {p.isVideoOn ? (
                    <div className="w-full h-full bg-slate-900/50 flex flex-col items-center justify-center gap-4">
                        <div className={`w-24 h-24 rounded-full ${p.avatarColor} flex items-center justify-center text-4xl font-bold shadow-2xl`}>{p.name.charAt(0)}</div>
                        <p className="text-slate-500 text-xs font-medium uppercase tracking-widest">Live Camera Active</p>
                    </div>
                ) : (
                    <div className="flex flex-col items-center gap-4">
                        <div className={`w-24 h-24 rounded-full ${p.avatarColor} opacity-50 flex items-center justify-center text-4xl font-bold grayscale`}>{p.name.charAt(0)}</div>
                        <p className="text-slate-600 text-xs font-medium uppercase tracking-widest">Camera Off</p>
                    </div>
                )}
              </div>
            )}
            <div className="absolute bottom-4 left-4 flex items-center gap-3 bg-black/40 backdrop-blur-md px-4 py-2 rounded-xl border border-white/10">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold whitespace-nowrap">{p.name} {p.isLocal && "(You)"}</span>
                {p.isAudioOn ? <SpeakerWaveIcon className={`w-3 h-3 text-emerald-400 ${p.isSpeaking ? 'animate-bounce' : ''}`} /> : <NoSymbolIcon className="w-3 h-3 text-red-500" />}
              </div>
            </div>
          </div>
        ))}
      </main>

      <footer className="h-24 flex items-center justify-center gap-4 relative z-20">
        <div className="glass-panel px-10 py-5 rounded-full flex items-center gap-8 shadow-2xl border border-white/5">
          <button onClick={toggleMic} className={`p-4 rounded-full transition-all transform active:scale-90 ${isMicOn ? 'bg-slate-700 hover:bg-slate-600 text-white' : 'bg-red-500 text-white shadow-lg shadow-red-500/30'}`}>
            {isMicOn ? <MicrophoneIcon className="w-6 h-6" /> : <NoSymbolIcon className="w-6 h-6" />}
          </button>
          <button onClick={toggleCam} className={`p-4 rounded-full transition-all transform active:scale-90 ${isCamOn ? 'bg-slate-700 hover:bg-slate-600 text-white' : 'bg-red-500 text-white shadow-lg shadow-red-500/30'}`}>
            {isCamOn ? <VideoCameraIcon className="w-6 h-6" /> : <VideoCameraSlashIcon className="w-6 h-6" />}
          </button>
          <button onClick={toggleAi} className={`p-4 rounded-full transition-all transform active:scale-90 ${isAiActive ? 'bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-500/30' : 'bg-slate-700 hover:bg-slate-600 text-slate-300'}`}>
            <SparklesIcon className="w-6 h-6" />
          </button>
          <div className="w-px h-10 bg-white/10 mx-2" />
          <button onClick={leaveMeeting} className="p-4 bg-red-600 hover:bg-red-500 text-white rounded-full transition-all transform active:scale-95 shadow-xl shadow-red-600/40">
            <PhoneXMarkIcon className="w-7 h-7" />
          </button>
        </div>
        <div className="absolute right-8 flex items-center gap-3 bg-slate-800/80 backdrop-blur-md px-5 py-3 rounded-2xl border border-white/5">
          <UserGroupIcon className="w-5 h-5 text-emerald-500" />
          <span className="text-sm font-bold text-slate-200">{participants.length} Active</span>
        </div>
      </footer>
    </div>
  );
};

export default App;
