/**
 * Response Classifier
 * Automatically categorizes incoming messages to determine lead intent
 */

export type ResponseIntent =
    | 'interested'
    | 'not_interested'
    | 'meeting_request'
    | 'question'
    | 'objection'
    | 'out_of_office'
    | 'unsubscribe'
    | 'neutral';

export interface ClassificationResult {
    intent: ResponseIntent;
    confidence: number;
    signals: string[];
    suggestedAction: 'schedule_meeting' | 'send_followup' | 'archive' | 'escalate' | 'wait';
}

// Keyword patterns for each intent
const PATTERNS: Record<ResponseIntent, { positive: string[]; negative?: string[] }> = {
    interested: {
        positive: [
            'интересно', 'расскажите', 'подробнее', 'хотел бы', 'когда можем',
            'interested', 'tell me more', 'sounds good', 'let\'s talk', 'schedule',
            'давайте', 'покажите', 'demo', 'демо', 'презентация', 'созвон',
            'yes', 'да', 'конечно', 'отлично', 'супер', 'perfect', 'great'
        ],
        negative: ['не интересно', 'not interested', 'нет']
    },
    not_interested: {
        positive: [
            'не интересно', 'не нужно', 'not interested', 'no thanks', 'no thank you',
            'не актуально', 'не подходит', 'отказ', 'decline', 'pass',
            'already have', 'уже есть', 'не сейчас', 'not now', 'maybe later'
        ]
    },
    meeting_request: {
        positive: [
            'давайте созвонимся', 'let\'s meet', 'schedule a call', 'book a meeting',
            'когда удобно', 'свободны', 'available', 'calendar', 'календарь',
            'zoom', 'google meet', 'teams', 'созвон', 'встреча', 'call',
            'завтра', 'на неделе', 'this week', 'tomorrow', 'next week'
        ]
    },
    question: {
        positive: [
            '?', 'как', 'что', 'почему', 'зачем', 'сколько', 'какой',
            'how', 'what', 'why', 'when', 'where', 'which', 'who',
            'can you', 'could you', 'would you', 'is it', 'are you',
            'подскажите', 'объясните', 'explain', 'clarify'
        ]
    },
    objection: {
        positive: [
            'дорого', 'expensive', 'too much', 'слишком', 'budget', 'бюджет',
            'competitor', 'конкурент', 'уже используем', 'already using',
            'не уверен', 'not sure', 'сомневаюсь', 'doubt', 'риски', 'risk'
        ]
    },
    out_of_office: {
        positive: [
            'out of office', 'отсутствую', 'в отпуске', 'vacation', 'holiday',
            'вернусь', 'be back', 'away', 'limited access', 'автоответ',
            'auto-reply', 'automatic reply'
        ]
    },
    unsubscribe: {
        positive: [
            'отписаться', 'unsubscribe', 'стоп', 'stop', 'remove', 'удалите',
            'прекратите', 'больше не пишите', 'don\'t contact', 'spam', 'спам'
        ]
    },
    neutral: {
        positive: []
    }
};

// Action mapping for each intent
const ACTION_MAP: Record<ResponseIntent, ClassificationResult['suggestedAction']> = {
    interested: 'schedule_meeting',
    meeting_request: 'schedule_meeting',
    not_interested: 'archive',
    unsubscribe: 'archive',
    out_of_office: 'wait',
    question: 'send_followup',
    objection: 'escalate',
    neutral: 'wait'
};

export class ResponseClassifier {
    /**
     * Classify a message and determine lead intent
     */
    classify(messageContent: string): ClassificationResult {
        const normalized = messageContent.toLowerCase().trim();
        const signals: string[] = [];
        const scores: Record<ResponseIntent, number> = {
            interested: 0,
            not_interested: 0,
            meeting_request: 0,
            question: 0,
            objection: 0,
            out_of_office: 0,
            unsubscribe: 0,
            neutral: 0
        };

        // Score each intent
        for (const [intent, patterns] of Object.entries(PATTERNS) as [ResponseIntent, typeof PATTERNS[ResponseIntent]][]) {
            // Check negative patterns first (these disqualify the intent)
            if (patterns.negative?.some(neg => normalized.includes(neg))) {
                scores[intent] = -10;
                continue;
            }

            // Score positive patterns
            for (const pattern of patterns.positive) {
                if (normalized.includes(pattern)) {
                    scores[intent] += 1;
                    signals.push(`"${pattern}" → ${intent}`);
                }
            }
        }

        // Find highest scoring intent
        let topIntent: ResponseIntent = 'neutral';
        let topScore = 0;

        for (const [intent, score] of Object.entries(scores) as [ResponseIntent, number][]) {
            if (score > topScore) {
                topScore = score;
                topIntent = intent;
            }
        }

        // Calculate confidence (0-1)
        const confidence = Math.min(topScore / 3, 1); // 3+ matches = 100% confidence

        return {
            intent: topIntent,
            confidence,
            signals,
            suggestedAction: ACTION_MAP[topIntent]
        };
    }

    /**
     * Quick check if message indicates interest
     */
    isInterested(messageContent: string): boolean {
        const result = this.classify(messageContent);
        return result.intent === 'interested' || result.intent === 'meeting_request';
    }

    /**
     * Quick check if lead should be archived
     */
    shouldArchive(messageContent: string): boolean {
        const result = this.classify(messageContent);
        return result.intent === 'not_interested' || result.intent === 'unsubscribe';
    }
}

// Singleton
export const responseClassifier = new ResponseClassifier();
