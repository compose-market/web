export interface LyriaQueueChunk {
  type: "audio";
  data: string;
  format: "pcm16";
  sampleRate: number;
  channels: number;
}

export function consumeLyriaAudioQueue(
  queue: LyriaQueueChunk[],
  processedCount: number,
): LyriaQueueChunk[] {
  if (processedCount <= 0) {
    return queue;
  }

  if (processedCount >= queue.length) {
    return [];
  }

  return queue.slice(processedCount);
}

export function enqueueLyriaAudioChunk(
  queue: LyriaQueueChunk[],
  chunk: LyriaQueueChunk,
  maxQueueLength = 120,
): LyriaQueueChunk[] {
  const nextQueue = [...queue, chunk];
  if (nextQueue.length <= maxQueueLength) {
    return nextQueue;
  }

  return nextQueue.slice(nextQueue.length - maxQueueLength);
}
