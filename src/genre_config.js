// =============================================
// L2S — Genre Configuration & Scoring Config
// =============================================
// All weights, thresholds, and genre-specific tuning in one place.
// Edit this file to tune clip selection quality.

// ─── Scoring Signal Weights per Genre ────────
// Each genre defines how much each signal contributes to the final score.
// Weights must sum to ~1.0. Adjust to taste.

export const GENRE_PROFILES = {
  motivational: {
    label: 'Motivational',
    weights: {
      hook: 0.15,
      standalone: 0.10,
      payoff: 0.25,
      emotion: 0.25,
      topicDensity: 0.10,
      lengthFit: 0.15,
    },
    keywords: [
      'believe', 'mindset', 'grind', 'hustle', 'discipline', 'success',
      'never give up', 'hard work', 'passion', 'purpose', 'dream', 'goals',
      'overcome', 'struggle', 'failure', 'resilience', 'courage', 'strength',
      'sacrifice', 'dedication', 'focus', 'persist', 'determined', 'champion',
      'unstoppable', 'impossible', 'rise', 'fight', 'conquer', 'warrior',
      'legacy', 'greatness', 'potential', 'transform', 'breakthrough',
      'action', 'commit', 'execute', 'achieve', 'earn',
    ],
    llmModifier: `You are scoring for MOTIVATIONAL viral potential.
Prioritize:
- Emotional peaks and goosebump moments
- Imperative/actionable language ("You need to...", "Stop doing...", "Start today...")
- Personal struggle → triumph arcs
- Powerful one-liners that could be quoted
Penalize:
- Generic platitudes without specific advice
- Vague feel-good fluff with no substance
- Segments that need prior context to land emotionally`,
  },

  funny: {
    label: 'Comedy',
    weights: {
      hook: 0.10,
      standalone: 0.15,
      payoff: 0.30,
      emotion: 0.20,
      topicDensity: 0.10,
      lengthFit: 0.15,
    },
    keywords: [
      'hilarious', 'joke', 'punchline', 'laughing', 'funny', 'comedy',
      'ridiculous', 'absurd', 'stupid', 'crazy', 'insane', 'wild',
      'dead', 'dying', 'bruh', 'bro', 'lmao', 'literally',
      'imagine', 'plot twist', 'unexpected', 'wait for it', 'caught',
      'awkward', 'embarrassing', 'cringe', 'sus', 'roast',
    ],
    llmModifier: `You are scoring for COMEDY viral potential.
Prioritize:
- Punchline timing — does the segment build to a laugh?
- Surprise/subversion of expectations
- Relatable humor that makes viewers tag a friend
- Reaction-worthy moments ("I can't believe they said that")
Penalize:
- Setup without payoff (all build-up, no punchline)
- Inside jokes that require context
- Dry explanations or monotone delivery cues`,
  },

  educational: {
    label: 'Educational',
    weights: {
      hook: 0.15,
      standalone: 0.20,
      payoff: 0.20,
      emotion: 0.10,
      topicDensity: 0.20,
      lengthFit: 0.15,
    },
    keywords: [
      'learn', 'study', 'research', 'science', 'fact', 'discover',
      'explain', 'understand', 'reason', 'because', 'actually',
      'most people', 'myth', 'truth', 'prove', 'evidence', 'data',
      'technique', 'method', 'strategy', 'tip', 'trick', 'hack',
      'mistake', 'wrong', 'correct', 'important', 'key', 'secret',
      'step', 'process', 'system', 'framework', 'principle',
    ],
    llmModifier: `You are scoring for EDUCATIONAL viral potential.
Prioritize:
- "I never knew that" / "aha moment" reveals
- Clear claim + supporting explanation
- Standalone clarity — viewer learns something complete in this clip
- Surprising facts that challenge common knowledge
Penalize:
- Jargon-heavy content without explanation
- Incomplete explanations that cut off mid-point
- Obvious knowledge everyone already knows`,
  },

  storytime: {
    label: 'Storytime',
    weights: {
      hook: 0.20,
      standalone: 0.15,
      payoff: 0.25,
      emotion: 0.20,
      topicDensity: 0.05,
      lengthFit: 0.15,
    },
    keywords: [
      'story', 'happened', 'suddenly', 'moment', 'realize', 'remember',
      'one day', 'years ago', 'back when', 'little did', 'turned out',
      'plot twist', 'never expected', 'changed everything', 'worst day',
      'best day', 'couldn\'t believe', 'shocked', 'terrified', 'thrilled',
      'confession', 'secret', 'reveal', 'caught', 'escaped', 'survived',
    ],
    llmModifier: `You are scoring for STORYTIME viral potential.
Prioritize:
- Dramatic reveals and emotional twists
- Strong narrative hook that creates curiosity
- Mini story arcs (setup → tension → resolution)
- Cliffhanger moments that make viewers want more
Penalize:
- Slow build without a hook in the first 3 seconds
- Context-dependent narration (references to "what I said earlier")
- Monotone retelling without emotional peaks`,
  },

  tech: {
    label: 'Tech / Reviews',
    weights: {
      hook: 0.15,
      standalone: 0.20,
      payoff: 0.20,
      emotion: 0.10,
      topicDensity: 0.20,
      lengthFit: 0.15,
    },
    keywords: [
      'feature', 'update', 'release', 'specs', 'performance', 'benchmark',
      'review', 'comparison', 'versus', 'better', 'worse', 'upgrade',
      'bug', 'fix', 'hack', 'shortcut', 'hidden', 'setting',
      'app', 'software', 'hardware', 'device', 'phone', 'laptop',
      'ai', 'machine learning', 'algorithm', 'code', 'developer',
      'game changer', 'revolutionary', 'overrated', 'underrated',
    ],
    llmModifier: `You are scoring for TECH/REVIEW viral potential.
Prioritize:
- Surprising reveals ("nobody talks about this feature")
- Hot takes and honest opinions that spark debate
- Clear, demonstrable tips viewers can immediately use
- Comparisons with clear winners/losers
Penalize:
- Dry spec recitations without context or opinion
- Vague impressions ("it feels nice") without specifics
- Segments requiring seeing the screen to understand`,
  },

  gaming: {
    label: 'Gaming',
    weights: {
      hook: 0.15,
      standalone: 0.15,
      payoff: 0.25,
      emotion: 0.20,
      topicDensity: 0.10,
      lengthFit: 0.15,
    },
    keywords: [
      'clutch', 'epic', 'insane', 'play', 'kill', 'win', 'lose',
      'rage', 'noob', 'pro', 'hack', 'glitch', 'exploit', 'secret',
      'speedrun', 'world record', 'impossible', 'challenge', 'boss',
      'loot', 'drop', 'rare', 'legendary', 'broken', 'nerf', 'buff',
      'reaction', 'fail', 'clutch', 'ace', 'comeback', 'carry',
    ],
    llmModifier: `You are scoring for GAMING viral potential.
Prioritize:
- Epic plays, clutch moments, impossible feats
- Hilarious fails and rage reactions
- "Did you know" game facts and hidden secrets
- Jaw-dropping moments that make viewers say "no way"
Penalize:
- Ordinary gameplay without standout moments
- Long setup without payoff
- Commentary that requires seeing the game to understand`,
  },

  news: {
    label: 'News',
    weights: {
      hook: 0.20,
      standalone: 0.25,
      payoff: 0.15,
      emotion: 0.15,
      topicDensity: 0.15,
      lengthFit: 0.10,
    },
    keywords: [
      'breaking', 'report', 'investigation', 'revealed', 'scandal',
      'controversy', 'debate', 'policy', 'government', 'election',
      'crisis', 'emergency', 'update', 'confirmed', 'denied',
      'source', 'exclusive', 'leaked', 'insider', 'whistleblower',
      'impact', 'affect', 'million', 'billion', 'record',
    ],
    llmModifier: `You are scoring for NEWS viral potential.
Prioritize:
- Controversial takes that spark debate
- Shocking revelations with broad impact
- Issues that affect many people directly
- Clear, concise reporting of significant events
Penalize:
- Dry, monotone reporting without engagement
- Hyperlocal news with no broad appeal
- Segments that require extensive background context`,
  },

  music: {
    label: 'Music',
    weights: {
      hook: 0.15,
      standalone: 0.15,
      payoff: 0.20,
      emotion: 0.25,
      topicDensity: 0.10,
      lengthFit: 0.15,
    },
    keywords: [
      'song', 'beat', 'rhythm', 'melody', 'vocals', 'lyrics',
      'album', 'track', 'release', 'artist', 'band', 'concert',
      'perform', 'cover', 'remix', 'sample', 'produce', 'mix',
      'vibe', 'fire', 'slaps', 'banger', 'classic', 'masterpiece',
    ],
    llmModifier: `You are scoring for MUSIC viral potential.
Prioritize:
- Emotional vocal moments or instrument highlights
- Behind-the-scenes creative insights
- Hot takes on popular music
- Educational breakdowns of musical techniques
Penalize:
- Segments that are purely background music with no commentary
- Extended silent or low-energy passages`,
  },

  sports: {
    label: 'Sports',
    weights: {
      hook: 0.15,
      standalone: 0.15,
      payoff: 0.25,
      emotion: 0.20,
      topicDensity: 0.10,
      lengthFit: 0.15,
    },
    keywords: [
      'goal', 'score', 'win', 'lose', 'champion', 'final', 'match',
      'record', 'history', 'legend', 'goat', 'clutch', 'comeback',
      'injury', 'trade', 'draft', 'rookie', 'veteran', 'dynasty',
      'rivalry', 'upset', 'underdog', 'dominant', 'undefeated',
    ],
    llmModifier: `You are scoring for SPORTS viral potential.
Prioritize:
- Dramatic game moments and clutch plays
- Hot takes and debate-sparking opinions
- Historic achievements and record-breaking moments
- Emotional reactions and celebrations
Penalize:
- Play-by-play commentary without standout moments
- Statistical analysis without narrative context`,
  },

  vlog: {
    label: 'Vlog',
    weights: {
      hook: 0.20,
      standalone: 0.15,
      payoff: 0.20,
      emotion: 0.20,
      topicDensity: 0.10,
      lengthFit: 0.15,
    },
    keywords: [
      'day', 'morning', 'night', 'routine', 'travel', 'explore',
      'try', 'experience', 'first time', 'surprise', 'adventure',
      'life', 'real', 'honest', 'authentic', 'behind the scenes',
      'update', 'moving', 'buying', 'eating', 'cooking', 'making',
    ],
    llmModifier: `You are scoring for VLOG viral potential.
Prioritize:
- Authentic, relatable moments viewers connect with
- Surprising or unexpected events
- Beautiful or aspirational visuals described in narration
- Emotional honest moments (vulnerability, excitement, shock)
Penalize:
- Mundane activities without entertainment value
- "So today I'm going to..." without a compelling hook
- Segments requiring visual context not present in audio`,
  },

  cooking: {
    label: 'Cooking',
    weights: {
      hook: 0.15,
      standalone: 0.20,
      payoff: 0.20,
      emotion: 0.15,
      topicDensity: 0.15,
      lengthFit: 0.15,
    },
    keywords: [
      'recipe', 'cook', 'bake', 'ingredient', 'secret', 'trick',
      'flavor', 'taste', 'delicious', 'crispy', 'juicy', 'tender',
      'easy', 'quick', 'minute', 'simple', 'homemade', 'fresh',
      'restaurant', 'chef', 'kitchen', 'hack', 'technique', 'tip',
      'mistake', 'never', 'always', 'perfect', 'best', 'worst',
    ],
    llmModifier: `You are scoring for COOKING viral potential.
Prioritize:
- Surprising cooking hacks or techniques
- "You've been doing it wrong" revelations
- Quick tips viewers can immediately try
- Dramatic before/after taste reactions
Penalize:
- Long ingredient lists without visual or narrative interest
- Step-by-step instructions that feel like a recipe reading
- Segments heavily dependent on seeing the food being prepared`,
  },

  // Default/auto — balanced weights for unknown genres
  default: {
    label: 'Auto-detect',
    weights: {
      hook: 0.18,
      standalone: 0.15,
      payoff: 0.20,
      emotion: 0.17,
      topicDensity: 0.12,
      lengthFit: 0.18,
    },
    keywords: [],
    llmModifier: `You are a world-class viral clip analyst.
Score based on general virality: strong hook, complete thought, emotional impact, shareability, and standalone value.`,
  },
};

// ─── Global Scoring Configuration ────────────
export const SCORING_CONFIG = {
  // Ideal short length range (seconds) — peak virality window
  idealLengthRange: [20, 45],

  // Hard floor/ceiling for clip duration (seconds)
  lengthPenaltyRange: [15, 90],

  // Sliding window configuration (optimized to reduce redundant candidates)
  windowSizes: [25, 40, 60, 80],       // seconds — balanced viral durations
  slideStep: 12,                        // seconds — step between windows (reduced redundancy)

  // Pre-filter: only send top N% to LLM (saves Ollama calls)
  preFilterTopPercent: 0.25,
  preFilterMinScore: 25,                // absolute minimum heuristic score

  // LLM batching
  llmBatchSize: 8,                      // segments per Ollama call
  llmMaxConcurrent: 2,                  // parallel Ollama calls

  // Diversity selection
  redundancyOverlapThreshold: 0.40,     // max time overlap ratio
  redundancySimilarityThreshold: 0.60,  // max text similarity (Jaccard trigrams)

  // Hook analysis
  hookWindowSeconds: 3,                 // first N seconds for hook scoring

  // Filler words that penalize hook strength
  fillerWords: [
    'um', 'uh', 'like', 'you know', 'basically', 'literally',
    'i mean', 'sort of', 'kind of', 'right', 'okay', 'so yeah',
  ],

  // Continuation openers that indicate context-dependence
  continuationOpeners: [
    'so', 'and', 'but', 'because', 'also', 'plus', 'anyway',
    'as i was saying', 'like i said', 'going back to',
    'as i mentioned', 'that said', 'on top of that',
  ],

  // Dangling reference words (penalize standalone comprehensibility)
  danglingReferences: [
    'that', 'this', 'these', 'those', 'it', 'they', 'them',
    'he', 'she', 'him', 'her', 'his', 'hers', 'its',
  ],

  // Payoff markers — indicate a resolution/punchline/takeaway
  payoffMarkers: [
    'so the lesson', 'the point is', 'that\'s why', 'the takeaway',
    'the bottom line', 'in the end', 'turns out', 'the result',
    'the answer', 'the secret', 'the truth', 'the key',
    'here\'s what happened', 'here\'s the thing', 'long story short',
    'moral of the story', 'the punchline', 'believe it or not',
    'what i learned', 'the real reason', 'the conclusion',
  ],

  // Emotional intensity words
  emotionalWords: [
    'secret', 'mistake', 'never', 'always', 'million', 'billion',
    'worst', 'best', 'amazing', 'terrible', 'incredible', 'shocking',
    'unbelievable', 'genius', 'dangerous', 'brilliant', 'horrible',
    'fantastic', 'disaster', 'miracle', 'nightmare', 'legend', 'epic',
    'massive', 'destroy', 'save', 'love', 'hate', 'fear', 'angry',
    'excited', 'devastating', 'extraordinary', 'insane', 'ridiculous',
    'hilarious', 'tragic', 'critical', 'revolutionary', 'obsessed',
    'terrifying', 'mind-blowing', 'life-changing', 'game-changing',
  ],
};

// ─── Helper: Get genre profile by key ────────
export function getGenreProfile(genreKey) {
  const key = (genreKey || 'default').toLowerCase();
  return GENRE_PROFILES[key] || GENRE_PROFILES.default;
}
