/**
 * Migrate existing Redis leads to Supabase
 * Run once: npx tsx src/migrate-redis-to-pg.ts
 */
import { createClient as createRedisClient } from 'redis';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import 'dotenv/config';

async function migrate() {
    console.log('🚚 Migrating Redis leads → Supabase...\n');

    // Connect Redis
    const redis = createRedisClient({ url: process.env.REDIS_URL || 'redis://localhost:6379' });
    await redis.connect();

    // Connect Supabase
    const supabase = createSupabaseClient(
        process.env.SUPABASE_URL || '',
        process.env.SUPABASE_ANON_KEY || ''
    );

    // Get all lead keys
    const keys = await redis.keys('sales:leads:lead_*');
    console.log(`Found ${keys.length} leads in Redis\n`);

    if (keys.length === 0) {
        console.log('No leads to migrate.');
        await redis.quit();
        return;
    }

    let migrated = 0;
    let skipped = 0;
    let errors = 0;

    for (const key of keys) {
        try {
            const raw = await redis.get(key);
            if (!raw) { skipped++; continue; }

            const lead = JSON.parse(raw);

            const row = {
                id: lead.id,
                first_name: lead.firstName || '',
                last_name: lead.lastName || '',
                email: lead.email || null,
                phone: lead.phone || null,
                whatsapp_number: lead.whatsappNumber || null,
                company_name: lead.companyName || '',
                bin: lead.bin || null,
                industry: lead.industry || null,
                website: lead.website || null,
                linkedin_url: lead.linkedinUrl || null,
                twitter_handle: lead.twitterHandle || null,
                telegram_handle: lead.telegramHandle || null,
                state: lead.state || 'discovered',
                source: lead.source || 'manual',
                source_url: lead.sourceUrl || null,
                score: lead.score || 0,
                contact_attempts: lead.contactAttempts || 0,
                needs_research: lead.needsResearch || false,
                data_completeness: lead.dataCompleteness || 'minimal',
                signal_summary: lead.signalSummary || null,
                pain_point: lead.painPoint || null,
                current_sequence: lead.currentSequence || null,
                current_step_id: lead.currentStepId || null,
                last_contacted_at: lead.lastContactedAt || null,
                next_contact_at: lead.nextContactAt || null,
                tags: lead.tags || [],
                notes: lead.notes || [],
                contacts: lead.contacts || [],
                conversation_history: lead.conversationHistory || [],
                created_at: lead.createdAt || new Date().toISOString(),
                updated_at: lead.updatedAt || new Date().toISOString(),
            };

            const { error } = await supabase.from('leads').upsert(row, { onConflict: 'id' });

            if (error) {
                console.error(`  ❌ ${lead.companyName}: ${error.message}`);
                errors++;
            } else {
                console.log(`  ✅ ${lead.companyName} (${lead.phone || 'no phone'})`);
                migrated++;
            }
        } catch (err: any) {
            console.error(`  ❌ ${key}: ${err.message}`);
            errors++;
        }
    }

    console.log(`\n📊 Migration complete:`);
    console.log(`   ✅ Migrated: ${migrated}`);
    console.log(`   ⏭️  Skipped: ${skipped}`);
    console.log(`   ❌ Errors: ${errors}`);

    // Verify
    const { count } = await supabase.from('leads').select('id', { count: 'exact', head: true });
    console.log(`\n   📊 Total rows in Supabase: ${count}`);

    await redis.quit();
}

migrate().catch(console.error);
