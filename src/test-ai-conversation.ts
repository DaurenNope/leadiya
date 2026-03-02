/**
 * Test AI Conversation
 * Simulates WhatsApp conversation to test the AI sales bot
 */
import { leads } from './leads.js';
import { aiConversation } from './ai-conversation.js';
import * as readline from 'readline';

async function testConversation() {
    await leads.connect();

    // Get a KZ lead to test with
    const allLeads = await leads.getByState('discovered');
    const kzEducation = allLeads.filter(l =>
        l.phone?.startsWith('+7') &&
        l.signalSummary?.includes('education')
    );

    if (kzEducation.length === 0) {
        console.log('No KZ education leads found');
        await leads.disconnect();
        return;
    }

    const testLead = kzEducation[0];

    console.log('\n🤖 AI Sales Conversation Simulator\n');
    console.log('Testing with lead:', testLead.companyName);
    console.log('Phone:', testLead.phone);
    console.log('\n' + '='.repeat(50) + '\n');

    // Send initial message
    console.log('📤 INITIAL MESSAGE (bot sends first):');
    const initialMsg = `Здравствуйте! 👋

Это RahmetLabs — делаем автоматизацию для бизнеса.

Работали с Q University — сделали чат-бота для абитуриентов, который обрабатывает 70% обращений автоматически.

Есть ли у вас задачи, которые хотелось бы автоматизировать?`;

    console.log(initialMsg);
    console.log('\n' + '-'.repeat(50));

    // Interactive simulation
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    console.log('\n💬 Now simulate customer responses (type "quit" to exit)\n');

    const askForResponse = () => {
        rl.question('Customer: ', async (input) => {
            if (input.toLowerCase() === 'quit') {
                console.log('\n📊 Conversation State:', aiConversation.getConversation(testLead.id));
                rl.close();
                await leads.disconnect();
                return;
            }

            // Generate AI response
            console.log('\n🤔 AI thinking...');
            const response = await aiConversation.generateAIResponse(testLead, input);
            console.log('\n🤖 Bot:', response);
            console.log('\n' + '-'.repeat(50) + '\n');

            askForResponse();
        });
    };

    askForResponse();
}

testConversation().catch(console.error);
