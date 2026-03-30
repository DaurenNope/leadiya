import { Hono } from 'hono'
import Stripe from 'stripe'
import { db } from '@leadiya/db'
import { tenants } from '@leadiya/db'
import { eq } from 'drizzle-orm'
import { env } from '@leadiya/config'
import type { AppEnv } from '../types.js'

const stripe = new Stripe(env.STRIPE_SECRET_KEY)
const stripeRouter = new Hono<AppEnv>()

// Create checkout session
stripeRouter.post('/checkout', async (c) => {
  const tenant = c.get('tenant')
  if (!tenant?.id) {
    return c.json({ error: 'Tenant not configured' }, 400)
  }
  const { plan } = await c.req.json()

  const prices = {
    starter: process.env.STRIPE_PRICE_STARTER,
    growth: process.env.STRIPE_PRICE_GROWTH,
    agency: process.env.STRIPE_PRICE_AGENCY,
  }

  const priceId = prices[plan as keyof typeof prices]
  if (!priceId) {
    return c.json({ error: 'Invalid plan' }, 400)
  }

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    payment_method_types: ['card'],
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${process.env.APP_URL}/dashboard?success=true`,
    cancel_url: `${process.env.APP_URL}/dashboard?canceled=true`,
    metadata: { tenantId: tenant.id },
  })

  return c.json({ url: session.url })
})

// Stripe webhook handler
stripeRouter.post('/webhook', async (c) => {
  const sig = c.req.header('stripe-signature')
  if (!sig) {
    return c.json({ error: 'Missing signature' }, 400)
  }

  let event: Stripe.Event

  try {
    event = stripe.webhooks.constructEvent(
      await c.req.text(),
      sig,
      env.STRIPE_WEBHOOK_SECRET
    )
  } catch (err) {
    return c.json({ error: 'Invalid signature' }, 400)
  }

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session
      const tenantId = session.metadata?.tenantId

      if (tenantId) {
        await db.update(tenants)
          .set({
            stripeCustomerId: session.customer as string,
            stripeSubscriptionId: session.subscription as string,
            active: true,
            trialEndsAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000), // 14-day trial
          })
          .where(eq(tenants.id, tenantId))
      }
      break
    }
    case 'invoice.payment_succeeded': {
      const invoice = event.data.object as Stripe.Invoice
      const subscriptionId = invoice.subscription as string

      const [tenant] = await db
        .select()
        .from(tenants)
        .where(eq(tenants.stripeSubscriptionId, subscriptionId))
        .limit(1)

      if (tenant) {
        await db.update(tenants)
          .set({
            active: true,
            exportsUsed: 0,
            quotaResetAt: new Date(),
          })
          .where(eq(tenants.id, tenant.id))
      }
      break
    }
    case 'invoice.payment_failed': {
      const invoice = event.data.object as Stripe.Invoice
      const subscriptionId = invoice.subscription as string

      await db.update(tenants)
        .set({ active: false })
        .where(eq(tenants.stripeSubscriptionId, subscriptionId))
      break
    }
  }

  return c.json({ received: true })
})

export { stripeRouter }
