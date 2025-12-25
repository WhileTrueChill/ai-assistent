
export interface Participant {
  id: string;
  name: string;
  isLocal: boolean;
  isAI?: boolean;
  isVideoOn: boolean;
  isAudioOn: boolean;
  avatarColor: string;
  isSpeaking: boolean;
  stream?: MediaStream;
  lastFrame?: string; // Base64 encoded JPEG for simulated P2P video
}

export type MeetingStatus = 'idle' | 'joining' | 'connected' | 'ended';

export interface MeetingState {
  status: MeetingStatus;
  participants: Participant[];
  isMicOn: boolean;
  isCamOn: boolean;
  isAiActive: boolean;
}
