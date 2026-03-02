/**
 * Email Channel Adapter
 * Sends emails via SMTP or email API
 */

import { BaseChannelAdapter, type SendResult } from './base.js';
import type { Lead } from '../types.js';

interface EmailConfig {
    from: string;
    fromName: string;
    smtpHost?: string;
    smtpPort?: number;
    smtpUser?: string;
    smtpPass?: string;
    apiKey?: string;  // For services like SendGrid, Resend, etc.
    apiProvider?: 'sendgrid' | 'resend' | 'smtp';
}

export class EmailAdapter extends BaseChannelAdapter {
    readonly name = 'email' as const;
    private config: EmailConfig;

    constructor(config?: Partial<EmailConfig>) {
        super();
        this.config = {
            from: config?.from || process.env.EMAIL_FROM || 'sales@rahmetlabs.xyz',
            fromName: config?.fromName || process.env.EMAIL_FROM_NAME || 'Rahmet Labs',
            smtpHost: config?.smtpHost || process.env.SMTP_HOST,
            smtpPort: config?.smtpPort || parseInt(process.env.SMTP_PORT || '587'),
            smtpUser: config?.smtpUser || process.env.SMTP_USER,
            smtpPass: config?.smtpPass || process.env.SMTP_PASS,
            apiKey: config?.apiKey || process.env.EMAIL_API_KEY,
            apiProvider: (config?.apiProvider || process.env.EMAIL_PROVIDER || 'smtp') as EmailConfig['apiProvider'],
        };
    }

    canReach(lead: Lead): boolean {
        return !!lead.email && this.isValidEmail(lead.email);
    }

    getContactId(lead: Lead): string | null {
        return lead.email || null;
    }

    private isValidEmail(email: string): boolean {
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    }

    /**
     * Parse email template with subject line
     * Template format: "Subject: ...\n\n<body>"
     */
    private parseEmailTemplate(message: string): { subject: string; body: string } {
        const lines = message.split('\n');

        if (lines[0].toLowerCase().startsWith('subject:')) {
            const subject = lines[0].replace(/^subject:\s*/i, '').trim();
            const body = lines.slice(1).join('\n').trim();
            return { subject, body };
        }

        // Generate subject from first line if not specified
        const firstLine = lines[0].substring(0, 60);
        return {
            subject: firstLine.endsWith('.') ? firstLine : firstLine + '...',
            body: message,
        };
    }

    async send(lead: Lead, message: string): Promise<SendResult> {
        const email = this.getContactId(lead);

        if (!email) {
            return this.createResult(false, '', { error: 'No email address available' });
        }

        const { subject, body } = this.parseEmailTemplate(message);

        this.log('Sending email', {
            to: email,
            subject,
            provider: this.config.apiProvider
        });

        try {
            let messageId: string;

            switch (this.config.apiProvider) {
                case 'resend':
                    messageId = await this.sendViaResend(email, subject, body);
                    break;
                case 'sendgrid':
                    messageId = await this.sendViaSendGrid(email, subject, body);
                    break;
                default:
                    messageId = await this.sendViaSMTP(email, subject, body);
            }

            this.log('Email sent', { messageId, to: email });
            return this.createResult(true, email, { messageId });

        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : 'Unknown error';
            this.log('Send failed', { error: errorMsg });
            return this.createResult(false, email, { error: errorMsg });
        }
    }

    private async sendViaSMTP(to: string, subject: string, body: string): Promise<string> {
        // In production, use nodemailer or similar
        // For now, simulate
        this.log('SMTP send', { to, subject });

        // Simulate SMTP sending
        await new Promise(resolve => setTimeout(resolve, 100));

        return `smtp_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    }

    private async sendViaResend(to: string, subject: string, body: string): Promise<string> {
        if (!this.config.apiKey) {
            throw new Error('Resend API key not configured');
        }

        const response = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${this.config.apiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                from: `${this.config.fromName} <${this.config.from}>`,
                to: [to],
                subject,
                text: body,
            }),
        });

        if (!response.ok) {
            const error = await response.text();
            throw new Error(`Resend API error: ${error}`);
        }

        const data = await response.json() as { id: string };
        return data.id;
    }

    private async sendViaSendGrid(to: string, subject: string, body: string): Promise<string> {
        if (!this.config.apiKey) {
            throw new Error('SendGrid API key not configured');
        }

        const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${this.config.apiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                personalizations: [{ to: [{ email: to }] }],
                from: { email: this.config.from, name: this.config.fromName },
                subject,
                content: [{ type: 'text/plain', value: body }],
            }),
        });

        if (!response.ok) {
            const error = await response.text();
            throw new Error(`SendGrid API error: ${error}`);
        }

        // SendGrid doesn't return message ID in response, generate one
        return `sg_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    }

    async isReady(): Promise<boolean> {
        // Check if we have necessary credentials
        if (this.config.apiProvider === 'smtp') {
            return !!(this.config.smtpHost && this.config.smtpUser);
        }
        return !!this.config.apiKey;
    }
}

// Singleton
export const email = new EmailAdapter();
