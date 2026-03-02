/**
 * Validation Gate
 * Ensures every lead has actionable contact data before storage.
 * No empty profiles allowed — every record must be worth reaching out to.
 */

export interface RawLead {
    companyName: string;
    phone?: string;
    email?: string;
    website?: string;
    instagram?: string;
    whatsapp?: string;
    telegram?: string;
    facebook?: string;
    linkedin?: string;
    address?: string;
    category?: string;
    city?: string;
    bin?: string;
    director?: string;
    allPhones?: string[];
    allEmails?: string[];
    rating?: number;
    source: string;
    sourceUrl?: string;
    tags?: string[];
    notes?: string[];
    [key: string]: unknown;
}

export interface ValidationResult {
    valid: boolean;
    lead: RawLead;
    reasons: string[];
    completeness: 'rich' | 'standard' | 'minimal' | 'rejected';
}

/**
 * Normalize a phone number — strip non-digits, convert KZ leading-8 to 7
 */
export function normalizePhone(raw: string): string {
    const digits = raw.replace(/\D/g, '');
    // KZ: leading 8 → 7
    if (digits.length === 11 && digits.startsWith('8')) {
        return '7' + digits.slice(1);
    }
    return digits;
}

/**
 * Check if a phone looks valid (at least 10 digits)
 */
function isValidPhone(phone: string | undefined): boolean {
    if (!phone) return false;
    const digits = normalizePhone(phone);
    return digits.length >= 10;
}

/**
 * Check if an email looks valid
 */
function isValidEmail(email: string | undefined): boolean {
    if (!email) return false;
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

/**
 * Check if a social handle/URL exists
 */
function hasSocial(lead: RawLead): boolean {
    return !!(
        lead.instagram ||
        lead.whatsapp ||
        lead.telegram ||
        lead.facebook ||
        lead.linkedin
    );
}

/**
 * Validate and score a lead.
 *
 * RULES:
 *   - MUST have company name
 *   - MUST have at least 1 verified contact (phone OR email)
 *   - SHOULD have social media or website (bumps score)
 *
 * COMPLETENESS:
 *   rich     = phone + email + social/website
 *   standard = phone OR email + social/website
 *   minimal  = phone OR email only
 *   rejected = fails validation
 */
export function validateLead(raw: RawLead): ValidationResult {
    const reasons: string[] = [];

    // Must have company name
    if (!raw.companyName || raw.companyName.trim().length < 2) {
        reasons.push('missing_company_name');
    }

    // Consolidate all phones
    const phones = [
        ...(raw.phone ? [raw.phone] : []),
        ...(raw.allPhones || []),
        ...(raw.whatsapp ? [raw.whatsapp] : []),
    ].filter(isValidPhone);

    // Consolidate all emails
    const emails = [
        ...(raw.email ? [raw.email] : []),
        ...(raw.allEmails || []),
    ].filter(isValidEmail);

    const hasPhone = phones.length > 0;
    const hasEmail = emails.length > 0;
    const hasContact = hasPhone || hasEmail;
    const hasSocialOrWeb = hasSocial(raw) || !!raw.website;

    if (!hasContact) {
        reasons.push('no_verified_contact');
    }

    const valid = reasons.length === 0;

    // Score completeness
    let completeness: ValidationResult['completeness'];
    if (!valid) {
        completeness = 'rejected';
    } else if (hasPhone && hasEmail && hasSocialOrWeb) {
        completeness = 'rich';
    } else if (hasContact && hasSocialOrWeb) {
        completeness = 'standard';
    } else {
        completeness = 'minimal';
    }

    return { valid, lead: raw, reasons, completeness };
}

/**
 * Batch-validate an array of leads. Returns only valid ones.
 */
export function filterValid(leads: RawLead[]): { valid: RawLead[]; rejected: number; stats: Record<string, number> } {
    const stats = { rich: 0, standard: 0, minimal: 0, rejected: 0 };
    const valid: RawLead[] = [];

    for (const lead of leads) {
        const result = validateLead(lead);
        stats[result.completeness]++;
        if (result.valid) {
            valid.push(result.lead);
        }
    }

    return { valid, rejected: stats.rejected, stats };
}
