/**
 * Message Templates System
 * Stores and manages reusable message templates with variable substitution
 */

import { createClient, RedisClientType } from 'redis';

export interface MessageTemplate {
    id: string;
    name: string;
    category: 'cold_outreach' | 'followup' | 'offer' | 'greeting' | 'custom';
    content: string;
    variables: string[]; // e.g. ['firstName', 'companyName']
    language: 'en' | 'ru';
    createdAt: Date;
    updatedAt: Date;
    usageCount: number;
}

// Default templates
const DEFAULT_TEMPLATES: Omit<MessageTemplate, 'id' | 'createdAt' | 'updatedAt' | 'usageCount'>[] = [
    {
        name: 'Персональное предложение',
        category: 'cold_outreach',
        content: 'Здравствуйте, {{firstName}}! 👋\n\nМы помогаем компаниям как {{companyName}} увеличить продажи на 30%+ с помощью автоматизации.\n\nМожем обсудить?',
        variables: ['firstName', 'companyName'],
        language: 'ru',
    },
    {
        name: 'Быстрый followup',
        category: 'followup',
        content: 'Привет! Хотел уточнить - успели посмотреть мое предыдущее сообщение? 🙂',
        variables: [],
        language: 'ru',
    },
    {
        name: 'Специальное предложение',
        category: 'offer',
        content: '🔥 {{firstName}}, специально для {{companyName}}:\n\n{{offer}}\n\nПредложение действует до {{deadline}}',
        variables: ['firstName', 'companyName', 'offer', 'deadline'],
        language: 'ru',
    },
    {
        name: 'Cold Outreach EN',
        category: 'cold_outreach',
        content: 'Hi {{firstName}}! 👋\n\nI noticed {{companyName}} and thought we could help you grow faster with our automation tools.\n\nWould you be open to a quick chat?',
        variables: ['firstName', 'companyName'],
        language: 'en',
    },
    {
        name: 'Simple Greeting',
        category: 'greeting',
        content: 'Здравствуйте! 👋',
        variables: [],
        language: 'ru',
    },
];

class MessageTemplatesManager {
    private redis: RedisClientType | null = null;
    private templates: Map<string, MessageTemplate> = new Map();
    private readonly REDIS_KEY = 'leadiya:templates';

    async init(): Promise<void> {
        try {
            const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
            this.redis = createClient({ url: redisUrl });
            await this.redis.connect();
            console.log('📋 Message templates connected to Redis');
            await this.loadFromRedis();

            // Seed default templates if empty
            if (this.templates.size === 0) {
                await this.seedDefaults();
            }
        } catch (error) {
            console.warn('⚠️ Redis not available, using in-memory templates');
            await this.seedDefaults();
        }
    }

    private async loadFromRedis(): Promise<void> {
        if (!this.redis) return;

        try {
            const data = await this.redis.hGetAll(this.REDIS_KEY);
            for (const [id, json] of Object.entries(data)) {
                const template = JSON.parse(json);
                template.createdAt = new Date(template.createdAt);
                template.updatedAt = new Date(template.updatedAt);
                this.templates.set(id, template);
            }
            console.log(`📋 Loaded ${this.templates.size} templates from Redis`);
        } catch (error) {
            console.error('Failed to load templates from Redis:', error);
        }
    }

    private async seedDefaults(): Promise<void> {
        for (const tmpl of DEFAULT_TEMPLATES) {
            const id = `tmpl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
            const template: MessageTemplate = {
                ...tmpl,
                id,
                createdAt: new Date(),
                updatedAt: new Date(),
                usageCount: 0,
            };
            this.templates.set(id, template);
            await this.saveToRedis(template);
        }
        console.log(`📋 Seeded ${DEFAULT_TEMPLATES.length} default templates`);
    }

    private async saveToRedis(template: MessageTemplate): Promise<void> {
        if (!this.redis) return;

        try {
            await this.redis.hSet(this.REDIS_KEY, template.id, JSON.stringify(template));
        } catch (error) {
            console.error('Failed to save template to Redis:', error);
        }
    }

    private initialized = false;
    private async ensureInitialized(): Promise<void> {
        if (!this.initialized) {
            await this.init();
            this.initialized = true;
        }
    }

    async getAll(): Promise<MessageTemplate[]> {
        await this.ensureInitialized();
        return Array.from(this.templates.values()).sort((a, b) =>
            b.usageCount - a.usageCount || b.updatedAt.getTime() - a.updatedAt.getTime()
        );
    }

    async get(id: string): Promise<MessageTemplate | null> {
        await this.ensureInitialized();
        return this.templates.get(id) || null;
    }

    async getByCategory(category: MessageTemplate['category']): Promise<MessageTemplate[]> {
        await this.ensureInitialized();
        return Array.from(this.templates.values())
            .filter(t => t.category === category)
            .sort((a, b) => b.usageCount - a.usageCount);
    }

    async create(data: Omit<MessageTemplate, 'id' | 'createdAt' | 'updatedAt' | 'usageCount'>): Promise<MessageTemplate> {
        const id = `tmpl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const template: MessageTemplate = {
            ...data,
            id,
            createdAt: new Date(),
            updatedAt: new Date(),
            usageCount: 0,
        };
        this.templates.set(id, template);
        await this.saveToRedis(template);
        return template;
    }

    async update(id: string, data: Partial<MessageTemplate>): Promise<MessageTemplate | null> {
        const existing = this.templates.get(id);
        if (!existing) return null;

        const updated: MessageTemplate = {
            ...existing,
            ...data,
            id: existing.id, // Don't allow ID change
            createdAt: existing.createdAt,
            updatedAt: new Date(),
        };
        this.templates.set(id, updated);
        await this.saveToRedis(updated);
        return updated;
    }

    async delete(id: string): Promise<boolean> {
        const existed = this.templates.has(id);
        this.templates.delete(id);

        if (this.redis && existed) {
            try {
                await this.redis.hDel(this.REDIS_KEY, id);
            } catch (error) {
                console.error('Failed to delete template from Redis:', error);
            }
        }
        return existed;
    }

    async incrementUsage(id: string): Promise<void> {
        const template = this.templates.get(id);
        if (template) {
            template.usageCount++;
            template.updatedAt = new Date();
            await this.saveToRedis(template);
        }
    }

    /**
     * Render template with variable substitution
     */
    render(template: MessageTemplate, variables: Record<string, string>): string {
        let content = template.content;
        for (const [key, value] of Object.entries(variables)) {
            content = content.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
        }
        return content;
    }

    /**
     * Extract variables from template content
     */
    extractVariables(content: string): string[] {
        const matches = content.match(/\{\{(\w+)\}\}/g) || [];
        return [...new Set(matches.map(m => m.slice(2, -2)))];
    }
}

// Singleton instance
export const messageTemplates = new MessageTemplatesManager();
