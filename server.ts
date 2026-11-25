import 'dotenv/config';
import { GoogleGenAI, Type } from '@google/genai';
import express, { type Request, type Response } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = Number(process.env.PORT) || 3000;
const MODEL_ID = 'gemini-4-hydrogen';

function getGeminiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    return null;
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function clampString(val: unknown, maxLen: number, fallback = ''): string {
  if (typeof val !== 'string') return fallback;
  return val.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, maxLen);
}

function clampNumber(val: unknown, min: number, max: number, fallback: number): number {
  const n = typeof val === 'number' ? val : Number(val);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function handleGeminiError(res: Response, err: unknown, context: string): void {
  const message = err instanceof Error ? err.message : 'Upstream AI service error';
  const status = /API key|quota|401|403/i.test(message) ? 502 : 500;
  res.status(status).json({
    error: `${context}: ${message}`,
  });
}

async function startServer() {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '48kb' }));

  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({
      ok: true,
      aiConfigured: Boolean(getGeminiClient()),
      model: MODEL_ID,
    });
  });

  // 1. Procedural Mission Generator
  app.post('/api/ai/mission', async (req: Request, res: Response) => {
    const ai = getGeminiClient();
    if (!ai) {
      res.status(503).json({
        error: 'GEMINI_API_KEY is not configured on the server. Set GEMINI_API_KEY in Secrets to generate AI missions.',
      });
      return;
    }

    const objectiveHint = clampString(req.body?.objectiveType, 20, 'any');
    const timeHint = clampString(req.body?.timeOfDay, 20, 'any');
    const difficultyHint = clampString(req.body?.difficulty, 24, 'standard');
    const aircraftLabel = clampString(req.body?.aircraftLabel, 48, 'F-22A Raptor');

    try {
      const response = await ai.models.generateContent({
        model: MODEL_ID,
        contents: `Generate a tactical supersonic jet fighter mission over a coastal fjord and mountain airbase theater.
Player aircraft: ${aircraftLabel}.
Requested objective preference: ${objectiveHint} (must pick one of: destroy, escort, recon).
Requested time of day preference: ${timeHint} (must pick one of: dawn, day, dusk, night).
Difficulty preference: ${difficultyHint}.
Theater operational bounds: X in [-7500, 7500], Z in [-7500, 7500], Y altitude in [420, 2600] meters.
Home airbase runway is at (0, 18, -400).
Generate crisp, authentic military callsigns, sector names, a short 2-sentence briefing, and 2-3 spatial waypoints inside bounds.`,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              title: { type: Type.STRING },
              briefing: { type: Type.STRING },
              objectiveType: { type: Type.STRING, enum: ['destroy', 'escort', 'recon'] },
              timeOfDay: { type: Type.STRING, enum: ['dawn', 'day', 'dusk', 'night'] },
              weatherRegime: { type: Type.STRING, enum: ['CLEAR', 'BREEZY', 'SQUALL', 'STORM'] },
              enemyCount: { type: Type.INTEGER },
              difficultyMultiplier: { type: Type.NUMBER },
              targetName: { type: Type.STRING },
              sectorLabel: { type: Type.STRING },
              waypoints: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    label: { type: Type.STRING },
                    x: { type: Type.NUMBER },
                    y: { type: Type.NUMBER },
                    z: { type: Type.NUMBER },
                  },
                  required: ['label', 'x', 'y', 'z'],
                },
              },
            },
            required: [
              'title',
              'briefing',
              'objectiveType',
              'timeOfDay',
              'weatherRegime',
              'enemyCount',
              'difficultyMultiplier',
              'targetName',
              'sectorLabel',
              'waypoints',
            ],
          },
        },
      });

      const raw = JSON.parse(response.text || '{}') as Record<string, unknown>;
      const validObj = ['destroy', 'escort', 'recon'].includes(String(raw.objectiveType))
        ? (raw.objectiveType as 'destroy' | 'escort' | 'recon')
        : 'destroy';
      const validTod = ['dawn', 'day', 'dusk', 'night'].includes(String(raw.timeOfDay))
        ? (raw.timeOfDay as 'dawn' | 'day' | 'dusk' | 'night')
        : 'day';
      const validWx = ['CLEAR', 'BREEZY', 'SQUALL', 'STORM'].includes(String(raw.weatherRegime))
        ? (raw.weatherRegime as 'CLEAR' | 'BREEZY' | 'SQUALL' | 'STORM')
        : 'BREEZY';

      const rawWps = Array.isArray(raw.waypoints) ? raw.waypoints.slice(0, 4) : [];
      const waypoints = rawWps.map((wp, idx) => {
        const w = wp as Record<string, unknown>;
        return {
          id: `wp_${idx + 1}`,
          label: clampString(w.label, 24, `WAYPOINT ${idx + 1}`),
          x: clampNumber(w.x, -7500, 7500, idx === 0 ? -1800 : 1800),
          y: clampNumber(w.y, 420, 2600, 900),
          z: clampNumber(w.z, -7500, 7500, -2400 - idx * 1400),
          radius: validObj === 'recon' ? 380 : 450,
          completed: false,
        };
      });

      res.json({
        id: `ai_${Date.now().toString(36)}`,
        title: clampString(raw.title, 48, 'OPERATION NORTHERN TEMPEST'),
        briefing: clampString(raw.briefing, 240, 'Intercept hostile flight groups over the fjord sector and maintain air superiority.'),
        objectiveType: validObj,
        timeOfDay: validTod,
        weatherRegime: validWx,
        enemyCount: Math.round(clampNumber(raw.enemyCount, 2, 6, 3)),
        difficultyMultiplier: Number(clampNumber(raw.difficultyMultiplier, 0.85, 1.45, 1.0).toFixed(2)),
        targetName: clampString(raw.targetName, 40, 'CRIMSON FLIGHT'),
        sectorLabel: clampString(raw.sectorLabel, 32, 'FJORD CORRIDOR'),
        waypoints,
        isAiGenerated: true,
      });
    } catch (err) {
      handleGeminiError(res, err, 'Mission generator failed');
    }
  });

  // 2. Dynamic Tactical Radio Chatter (AWACS / Wingman / Enemy)
  app.post('/api/ai/comms', async (req: Request, res: Response) => {
    const ai = getGeminiClient();
    if (!ai) {
      res.status(503).json({
        error: 'GEMINI_API_KEY is not configured on the server.',
      });
      return;
    }

    const eventType = clampString(req.body?.eventType, 32, 'mission_start');
    const detail = clampString(req.body?.detail, 140, '');
    const aircraftLabel = clampString(req.body?.aircraftLabel, 48, 'F-22A Raptor');
    const weatherLabel = clampString(req.body?.weatherLabel, 32, 'COASTAL X-WIND');

    try {
      const response = await ai.models.generateContent({
        model: MODEL_ID,
        contents: `Generate a single authentic tactical fighter combat radio transmission (max 16 words).
Event: ${eventType}
Context: ${detail}
Player aircraft: ${aircraftLabel}
Weather: ${weatherLabel}
Rules:
- If event is enemy_retreat, speaker is a hostile bandit pilot issuing a terse retreat/taunt line.
- If event is splash or missile_inbound or hull_low, pick AWACS OVERLORD or WINGMAN VIPER-2.
- If event is escort_under_fire, speaker is ESCORT GUARDIAN-1 or AWACS OVERLORD.
- Keep radio phrasing terse, crisp, and military-authentic (no emojis or markdown).`,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              speaker: { type: Type.STRING },
              channel: { type: Type.STRING, enum: ['AWACS', 'WINGMAN', 'HOSTILE', 'COMMAND'] },
              tone: { type: Type.STRING, enum: ['info', 'warn', 'alert', 'hostile'] },
              text: { type: Type.STRING },
            },
            required: ['speaker', 'channel', 'tone', 'text'],
          },
        },
      });

      const raw = JSON.parse(response.text || '{}') as Record<string, unknown>;
      const channel = ['AWACS', 'WINGMAN', 'HOSTILE', 'COMMAND'].includes(String(raw.channel))
        ? raw.channel
        : 'AWACS';
      const tone = ['info', 'warn', 'alert', 'hostile'].includes(String(raw.tone))
        ? raw.tone
        : 'info';

      res.json({
        speaker: clampString(raw.speaker, 28, 'AWACS OVERLORD'),
        channel,
        tone,
        text: clampString(raw.text, 140, 'Overlord copies, picture clean on scope.'),
      });
    } catch (err) {
      handleGeminiError(res, err, 'Radio comms generation failed');
    }
  });

  // 3. Adaptive Difficulty Tuning
  app.post('/api/ai/difficulty', async (req: Request, res: Response) => {
    const ai = getGeminiClient();
    if (!ai) {
      res.status(503).json({
        error: 'GEMINI_API_KEY is not configured on the server.',
      });
      return;
    }

    const accuracyPct = clampNumber(req.body?.accuracyPct, 0, 100, 20);
    const kills = clampNumber(req.body?.kills, 0, 200, 0);
    const hullPct = clampNumber(req.body?.hullPct, 0, 100, 100);
    const flightTimeSec = clampNumber(req.body?.flightTimeSec, 0, 36000, 60);
    const wave = clampNumber(req.body?.wave, 1, 50, 1);

    try {
      const response = await ai.models.generateContent({
        model: MODEL_ID,
        contents: `Evaluate combat pilot performance and tune enemy AI difficulty parameters.
Metrics:
- Gun accuracy: ${accuracyPct}%
- Kills: ${kills} in ${Math.round(flightTimeSec)}s (wave ${wave})
- Remaining hull: ${hullPct}%
Guidelines:
- aiTurnScale in [0.75, 1.35]
- aiMissileCooldownScale in [0.75, 1.35] (lower = faster enemy reloads)
- aiAggression in [0.75, 1.35]
- waveSizeDelta integer in [-1, 2]
- coachingNote: one concise tactical tip (max 18 words).`,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              skillTier: { type: Type.STRING, enum: ['ROOKIE', 'VETERAN', 'ACE'] },
              aiTurnScale: { type: Type.NUMBER },
              aiMissileCooldownScale: { type: Type.NUMBER },
              aiAggression: { type: Type.NUMBER },
              waveSizeDelta: { type: Type.INTEGER },
              coachingNote: { type: Type.STRING },
            },
            required: [
              'skillTier',
              'aiTurnScale',
              'aiMissileCooldownScale',
              'aiAggression',
              'waveSizeDelta',
              'coachingNote',
            ],
          },
        },
      });

      const raw = JSON.parse(response.text || '{}') as Record<string, unknown>;
      const skillTier = ['ROOKIE', 'VETERAN', 'ACE'].includes(String(raw.skillTier))
        ? raw.skillTier
        : 'VETERAN';

      res.json({
        skillTier,
        aiTurnScale: Number(clampNumber(raw.aiTurnScale, 0.75, 1.35, 1.0).toFixed(2)),
        aiMissileCooldownScale: Number(clampNumber(raw.aiMissileCooldownScale, 0.75, 1.35, 1.0).toFixed(2)),
        aiAggression: Number(clampNumber(raw.aiAggression, 0.75, 1.35, 1.0).toFixed(2)),
        waveSizeDelta: Math.round(clampNumber(raw.waveSizeDelta, -1, 2, 0)),
        coachingNote: clampString(raw.coachingNote, 140, 'Manage airspeed above corner velocity and watch missile RWR cones.'),
      });
    } catch (err) {
      handleGeminiError(res, err, 'Adaptive difficulty tuning failed');
    }
  });

  // 4. In-Game Tactical Co-Pilot Assistant
  app.post('/api/ai/copilot', async (req: Request, res: Response) => {
    const ai = getGeminiClient();
    if (!ai) {
      res.status(503).json({
        error: 'GEMINI_API_KEY is not configured on the server. Set GEMINI_API_KEY in Secrets to talk to Co-Pilot.',
      });
      return;
    }

    const question = clampString(req.body?.question, 320, '');
    if (!question) {
      res.status(400).json({ error: 'Question cannot be empty.' });
      return;
    }
    const telemetry = clampString(req.body?.telemetrySummary, 400, '');
    const controls = clampString(req.body?.controlsSummary, 350, '');
    const mission = clampString(req.body?.missionSummary, 250, '');

    try {
      const response = await ai.models.generateContent({
        model: MODEL_ID,
        contents: `You are WSO / Co-Pilot inside a supersonic fighter simulator (Vanguard).
Answer the pilot's question concisely in 2-4 crisp plain-text sentences (no markdown bullets, no asterisks).
Reference live flight telemetry and keybindings when helpful.
Live Telemetry: ${telemetry}
Mission: ${mission}
Current Keybindings: ${controls}
Pilot Question: ${question}`,
      });

      res.json({
        reply: clampString(response.text, 600, 'Maintain airspeed above 300 knots and check your radar scope for bandits.'),
      });
    } catch (err) {
      handleGeminiError(res, err, 'Co-pilot assistant failed');
    }
  });

  // Mount Vite Dev Middleware or serve production dist
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    const clientDir = fs.existsSync(path.join(distDir, 'index.html')) ? distDir : __dirname;
    app.use(express.static(clientDir));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(clientDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Vanguard server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
