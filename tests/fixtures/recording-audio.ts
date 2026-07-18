/** Recording AudioBus fake for module vectors (M4 review P1). */

import type { AudioBus } from "@/shell/contract";

export interface RecordingAudio extends AudioBus {
  registered: Set<string>;
  plays: string[];
}

export function createRecordingAudio(): RecordingAudio {
  const registered = new Set<string>();
  const plays: string[] = [];
  return {
    registered,
    plays,
    register(name) {
      registered.add(name);
    },
    play(name) {
      plays.push(name);
    },
    unlocked: true,
    muted: false,
    setMuted() {},
    onMutedChange() {
      return () => {};
    },
    destroy() {},
  };
}
