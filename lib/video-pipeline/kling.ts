// lib/video-pipeline/kling.ts
const KLING_API_BASE = 'https://queue.fal.run/fal-ai/kling-video';

export async function submitKlingJob(videoPrompt: string): Promise<string> {
  const res = await fetch(`${KLING_API_BASE}/v1.6/standard/text-to-video`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Key ${process.env.KLING_API_KEY}`,
    },
    body: JSON.stringify({
      prompt: videoPrompt,
      aspect_ratio: '9:16',   // 쇼츠 세로형
      duration: '5',
    }),
  });

  const data = await res.json();
  return data.request_id; // polling용 job ID
}

export async function pollKlingJob(requestId: string) {
  const res = await fetch(
    `https://queue.fal.run/fal-ai/kling-video/requests/${requestId}/status`,
    {
      headers: { 'Authorization': `Key ${process.env.KLING_API_KEY}` },
    }
  );
  const data = await res.json();
  return {
    status: data.status,           // 'IN_QUEUE' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED'
    videoUrl: data.video?.url,
    errorMessage: data.error,
  };
}