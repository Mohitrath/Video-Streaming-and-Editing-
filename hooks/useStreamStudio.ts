import { useEffect, useRef, useState, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';

export interface ReelItem {
  name: string;
  url: string;
  size: number;
  createdAt: string;
}

export const useStreamStudio = () => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const socketRef = useRef<Socket | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const animFrameRef = useRef<number | null>(null);

  const [isLive, setIsLive] = useState(false);
  const [logs, setLogs] = useState<string[]>(['> System Ready.']);
  const [reels, setReels] = useState<ReelItem[]>([]);
  const [reelProgress, setReelProgress] = useState<number | null>(null);
  const [streamDuration, setStreamDuration] = useState(0);
  const streamStartRef = useRef<number | null>(null);
  const durationIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // [!] CRITICAL: Replace with your Laptop's IPv4 Address (e.g. 192.168.43.15)
  const BACKEND_URL = 'http://YOUR_LOCAL_IP_ADDRESS:3000';

  const addLog = useCallback(
    (msg: string) => setLogs((prev) => [...prev.slice(-49), `> ${msg}`]),
    []
  );

  // Fetch existing reels from server
  const fetchReels = useCallback(async () => {
    try {
      const res = await fetch(`${BACKEND_URL}/reels`);
      const data = await res.json();
      setReels(data.reels || []);
    } catch {
      addLog('Could not fetch reels from server.');
    }
  }, [BACKEND_URL, addLog]);

  // Delete a reel by filename
  const deleteReel = useCallback(
    async (name: string) => {
      try {
        await fetch(`${BACKEND_URL}/reels/${name}`, { method: 'DELETE' });
        setReels((prev) => prev.filter((r) => r.name !== name));
        addLog(`Deleted: ${name}`);
      } catch {
        addLog('Delete failed.');
      }
    },
    [BACKEND_URL, addLog]
  );

  useEffect(() => {
    socketRef.current = io(BACKEND_URL, { transports: ['websocket'] });

    socketRef.current.on('connect', () => {
      addLog('Connected to Backend.');
      fetchReels();
    });
    socketRef.current.on('logs', (msg: string) => addLog(msg));
    socketRef.current.on('stream-status', () => addLog('Receiving Broadcast...'));
    socketRef.current.on('reel-progress', (pct: number) => setReelProgress(pct));
    socketRef.current.on('reel-ready', (reel: ReelItem) => {
      setReelProgress(null);
      setReels((prev) => [reel, ...prev]);
    });

    // Init webcam
    const initCamera = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        if (videoRef.current) videoRef.current.srcObject = stream;
      } catch {
        addLog('Camera Access Denied.');
      }
    };

    // Draw loop
    const draw = () => {
      if (canvasRef.current && videoRef.current) {
        const ctx = canvasRef.current.getContext('2d');
        if (ctx) {
          ctx.drawImage(videoRef.current, 0, 0, 1280, 720);
        }
      }
      animFrameRef.current = requestAnimationFrame(draw);
    };

    initCamera();
    draw();

    return () => {
      socketRef.current?.disconnect();
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      if (durationIntervalRef.current) clearInterval(durationIntervalRef.current);
    };
  }, [BACKEND_URL, addLog, fetchReels]);

  const toggleStream = useCallback(() => {
    if (!isLive) {
      const stream = canvasRef.current?.captureStream(30);
      if (!stream) return;
      const recorder = new MediaRecorder(stream, { mimeType: 'video/webm' });
      recorder.ondataavailable = (e) => socketRef.current?.emit('video-chunk', e.data);
      recorder.start(1000);
      mediaRecorderRef.current = recorder;
      setIsLive(true);
      streamStartRef.current = Date.now();
      setStreamDuration(0);
      durationIntervalRef.current = setInterval(() => {
        setStreamDuration(Math.floor((Date.now() - (streamStartRef.current ?? Date.now())) / 1000));
      }, 1000);
      addLog('Streaming Started.');
    } else {
      mediaRecorderRef.current?.stop();
      setIsLive(false);
      if (durationIntervalRef.current) clearInterval(durationIntervalRef.current);
      addLog('Streaming Stopped.');
    }
  }, [isLive, addLog]);

  const createReel = useCallback(() => {
    setReelProgress(0);
    socketRef.current?.emit('make-reel');
  }, []);

  const createTrimmedReel = useCallback(
    (startSec: number, endSec: number) => {
      if (endSec <= startSec) {
        addLog('Error: End time must be after start time.');
        return;
      }
      setReelProgress(0);
      socketRef.current?.emit('make-trimmed-reel', { startSec, endSec });
      addLog(`Queued trimmed reel: ${startSec}s → ${endSec}s`);
    },
    [addLog]
  );

  return {
    videoRef,
    canvasRef,
    isLive,
    logs,
    reels,
    reelProgress,
    streamDuration,
    BACKEND_URL,
    toggleStream,
    createReel,
    createTrimmedReel,
    deleteReel,
    fetchReels,
  };
};
