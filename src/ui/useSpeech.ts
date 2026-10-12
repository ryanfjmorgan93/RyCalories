import { SpeechRecognition } from '@capacitor-community/speech-recognition';
import { Capacitor } from '@capacitor/core';
import { useCallback, useEffect, useRef, useState } from 'react';

export interface Speech {
  /** Speech recognition can be used here: on the phone, and the device has a recogniser. False on the web build. */
  available: boolean;
  listening: boolean;
  /** One plain line when the microphone could not be used, or null. */
  error: string | null;
  /** Start listening; `onText` gets the transcript so far each time it grows, until `stop`. */
  start: (onText: (transcript: string) => void) => Promise<void>;
  stop: () => Promise<void>;
}

/**
 * Dictation through the Android recogniser (`@capacitor-community/speech-recognition`), in British
 * English with partial results so the words appear as they are said. It needs the RECORD_AUDIO
 * permission, which is declared in the manifest and asked for the first time the microphone is
 * used. Everything is guarded: where the plugin or the permission is missing, `available` is false
 * or `error` says so, and typing carries on as before.
 */
export function useSpeech(): Speech {
  const [available, setAvailable] = useState(false);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const active = useRef(false);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    let alive = true;
    SpeechRecognition.available()
      .then((r) => {
        if (alive) setAvailable(r.available);
      })
      .catch(() => {
        if (alive) setAvailable(false);
      });
    return () => {
      alive = false;
      if (active.current) {
        active.current = false;
        void SpeechRecognition.stop().catch(() => undefined);
        void SpeechRecognition.removeAllListeners().catch(() => undefined);
      }
    };
  }, []);

  const start = useCallback(async (onText: (transcript: string) => void) => {
    setError(null);
    try {
      const permission = await SpeechRecognition.requestPermissions();
      if (permission.speechRecognition !== 'granted') {
        setError('The microphone is off for Iron. Allow it in Android settings.');
        return;
      }
      await SpeechRecognition.removeAllListeners();
      await SpeechRecognition.addListener('partialResults', (data) => {
        const heard = data.matches?.[0];
        if (heard) onText(heard);
      });
      await SpeechRecognition.addListener('listeningState', (data) => {
        if (data.status === 'stopped') {
          active.current = false;
          setListening(false);
        }
      });
      active.current = true;
      setListening(true);
      await SpeechRecognition.start({ language: 'en-GB', partialResults: true, popup: false });
    } catch {
      active.current = false;
      setListening(false);
      setError("Couldn't start the microphone.");
    }
  }, []);

  const stop = useCallback(async () => {
    active.current = false;
    setListening(false);
    try {
      await SpeechRecognition.stop();
    } catch {
      // Already stopped.
    }
  }, []);

  return { available, listening, error, start, stop };
}
