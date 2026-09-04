/**
 * Seed script for WhatsApp OS.
 *
 * Populates two realistic Pakistani e-commerce workspaces:
 *   1. "Akmal Couture" (`akmal-couture`) - High-end Eastern apparel brand
 *   2. "Karachi Electronics" (`karachi-electronics`) - Consumer electronics & gadgets store
 *
 * Designed to be idempotent (safe to run repeatedly) and non-destructive.
 * Uses integer minor units for all money amounts (e.g. PKR paisa).
 */

import { prisma } from './prisma';
import { hashPassword } from '../server/auth/password';

const DEMO_PASSWORD = 'Password1234!';

/**
 * The model the seeded agents are stamped with.
 *
 * Read from the environment rather than hardcoded because the runtime hands
 * `agent.model` to whichever provider is configured, so a row carrying an OpenAI
 * model name would fail on the first message of a Gemini deployment. `mock-model`
 * is the fallback: a freshly seeded database is for offline work until someone
 * configures a real provider.
 */
const SEED_AI_MODEL = process.env.AI_MODEL || 'mock-model';

/**
 * Gives a workspace one active default agent, idempotently.
 *
 * `AIAgent` has no natural unique key to upsert on — a workspace is expected to run
 * several agents eventually — so existence is checked by lookup. Seeded active,
 * because an inactive agent is indistinguishable from no agent to the runtime and
 * the seeded workspaces exist precisely so the AI path can be exercised.
 */
async function ensureSeedAgent(
  workspaceId: string,
  fields: {
    name: string;
    greeting: string;
    persona: string;
    role: 'SALES_SUPPORT' | 'SALES' | 'SUPPORT' | 'RECEPTIONIST' | 'ORDER_TAKER' | 'FOLLOW_UP';
    tone: 'PROFESSIONAL' | 'FRIENDLY' | 'CASUAL' | 'LUXURY' | 'CONCISE' | 'DETAILED';
  },
): Promise<string> {
  const existing = await prisma.aIAgent.findFirst({
    where: { workspaceId },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });

  if (existing) return existing.id;

  const agent = await prisma.aIAgent.create({
    data: {
      workspaceId,
      name: fields.name,
      greeting: fields.greeting,
      persona: fields.persona,
      role: fields.role,
      tone: fields.tone,
      model: SEED_AI_MODEL,
      isActive: true,
      isDefault: true,
    },
    select: { id: true },
  });

  return agent.id;
}

async function main() {
  console.log('🌱 Starting WhatsApp OS database seed...');

  const passwordHash = await hashPassword(DEMO_PASSWORD);

  // ───────────────────────────────────────────────────────────────────────────
  // 1. USERS & PLATFORM ADMIN
  // ───────────────────────────────────────────────────────────────────────────
  console.log('Creating users...');

  // Platform Admin / Akmal Couture Owner
  const ownerUser = await prisma.user.upsert({
    where: { email: 'ahmed@akmalcouture.pk' },
    update: { name: 'Ahmed Raza', isPlatformAdmin: true },
    create: {
      email: 'ahmed@akmalcouture.pk',
      name: 'Ahmed Raza',
      passwordHash,
      emailVerifiedAt: new Date(),
      isPlatformAdmin: true,
      locale: 'en',
      timezone: 'Asia/Karachi',
    },
  });

  // Akmal Couture Manager
  const managerUser = await prisma.user.upsert({
    where: { email: 'ayesha.manager@akmalcouture.pk' },
    update: { name: 'Ayesha Khan' },
    create: {
      email: 'ayesha.manager@akmalcouture.pk',
      name: 'Ayesha Khan',
      passwordHash,
      emailVerifiedAt: new Date(),
      locale: 'en',
      timezone: 'Asia/Karachi',
    },
  });

  // Akmal Couture Agent
  const agentUser = await prisma.user.upsert({
    where: { email: 'bilal.agent@akmalcouture.pk' },
    update: { name: 'Bilal Tariq' },
    create: {
      email: 'bilal.agent@akmalcouture.pk',
      name: 'Bilal Tariq',
      passwordHash,
      emailVerifiedAt: new Date(),
      locale: 'en',
      timezone: 'Asia/Karachi',
    },
  });

  // Karachi Electronics Owner
  const electronicsOwnerUser = await prisma.user.upsert({
    where: { email: 'zain@karachielectronics.pk' },
    update: { name: 'Zain Ul Abidin' },
    create: {
      email: 'zain@karachielectronics.pk',
      name: 'Zain Ul Abidin',
      passwordHash,
      emailVerifiedAt: new Date(),
      isPlatformAdmin: false,
      locale: 'en',
      timezone: 'Asia/Karachi',
    },
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 2. WORKSPACE 1: Akmal Couture (Eastern Apparel)
  // ───────────────────────────────────────────────────────────────────────────
  console.log('Seeding Workspace 1: Akmal Couture...');

  const ws1 = await prisma.workspace.upsert({
    where: { slug: 'akmal-couture' },
    update: { name: 'Akmal Couture', currency: 'PKR' },
    create: {
      slug: 'akmal-couture',
      name: 'Akmal Couture',
      category: 'Apparel & Fashion',
      currency: 'PKR',
      timezone: 'Asia/Karachi',
      locale: 'en',
      status: 'ACTIVE',
      onboardingCompletedSteps: ['profile', 'products', 'channels'],
    },
  });

  // Business Profile for Workspace 1
  await prisma.businessProfile.upsert({
    where: { workspaceId: ws1.id },
    update: {
      legalName: 'Akmal Couture Pvt Ltd',
      description: 'Luxury Pakistani Pret, Luxury Formals, and Handcrafted Festive Wear.',
      supportPhone: '+923001234567',
      supportEmail: 'support@akmalcouture.pk',
      website: 'https://akmalcouture.pk',
      addressLine1: 'Shop # 14, Zamzama Commercial Lane 5, Phase 5, DHA',
      city: 'Karachi',
      country: 'PK',
      deliveryFeeMinor: 25000, // PKR 250.00
      freeDeliveryThresholdMinor: 500000, // Free delivery over PKR 5,000.00
      paymentMethods: ['COD', 'BANK_TRANSFER', 'JAZZCASH', 'EASYPAISA'],
      shippingPolicy: 'Standard delivery takes 3-5 business days across Pakistan. Overnight express available in Karachi, Lahore, and Islamabad.',
      returnPolicy: 'Easy 7-day exchange for unworn items with original tags intact. Custom-stitched outfits are non-refundable.',
      businessHours: {
        monday: { open: '11:00', close: '21:00', closed: false },
        tuesday: { open: '11:00', close: '21:00', closed: false },
        wednesday: { open: '11:00', close: '21:00', closed: false },
        thursday: { open: '11:00', close: '21:00', closed: false },
        friday: { open: '14:30', close: '22:00', closed: false },
        saturday: { open: '11:00', close: '22:00', closed: false },
        sunday: { open: '14:00', close: '20:00', closed: false },
      },
    },
    create: {
      workspaceId: ws1.id,
      legalName: 'Akmal Couture Pvt Ltd',
      description: 'Luxury Pakistani Pret, Luxury Formals, and Handcrafted Festive Wear.',
      supportPhone: '+923001234567',
      supportEmail: 'support@akmalcouture.pk',
      website: 'https://akmalcouture.pk',
      addressLine1: 'Shop # 14, Zamzama Commercial Lane 5, Phase 5, DHA',
      city: 'Karachi',
      country: 'PK',
      deliveryFeeMinor: 25000,
      freeDeliveryThresholdMinor: 500000,
      paymentMethods: ['COD', 'BANK_TRANSFER', 'JAZZCASH', 'EASYPAISA'],
      shippingPolicy: 'Standard delivery takes 3-5 business days across Pakistan. Overnight express available in Karachi, Lahore, and Islamabad.',
      returnPolicy: 'Easy 7-day exchange for unworn items with original tags intact. Custom-stitched outfits are non-refundable.',
      businessHours: {
        monday: { open: '11:00', close: '21:00', closed: false },
        tuesday: { open: '11:00', close: '21:00', closed: false },
        wednesday: { open: '11:00', close: '21:00', closed: false },
        thursday: { open: '11:00', close: '21:00', closed: false },
        friday: { open: '14:30', close: '22:00', closed: false },
        saturday: { open: '11:00', close: '22:00', closed: false },
        sunday: { open: '14:00', close: '20:00', closed: false },
      },
    },
  });

  // AI agent for Workspace 1
  await ensureSeedAgent(ws1.id, {
    name: 'Zara',
    role: 'SALES_SUPPORT',
    tone: 'LUXURY',
    greeting:
      'Assalamualaikum! Akmal Couture mein khush aamdeed. Main Zara hoon — collection, prices ya delivery ke baare mein poochein.',
    persona:
      'You represent a luxury Pakistani pret and formalwear house in Karachi. Warm and unhurried, never pushy. Customers write in English, Urdu and Roman Urdu, often mixed, and you reply in whichever they used. Quote a price, a size or a delivery time only when a tool has returned it.',
  });

  // Members for Workspace 1
  const ws1OwnerMember = await prisma.workspaceMember.upsert({
    where: { workspaceId_userId: { workspaceId: ws1.id, userId: ownerUser.id } },
    update: { role: 'OWNER', status: 'ACTIVE' },
    create: {
      workspaceId: ws1.id,
      userId: ownerUser.id,
      role: 'OWNER',
      status: 'ACTIVE',
    },
  });

  const ws1ManagerMember = await prisma.workspaceMember.upsert({
    where: { workspaceId_userId: { workspaceId: ws1.id, userId: managerUser.id } },
    update: { role: 'MANAGER', status: 'ACTIVE' },
    create: {
      workspaceId: ws1.id,
      userId: managerUser.id,
      role: 'MANAGER',
      status: 'ACTIVE',
    },
  });

  const ws1AgentMember = await prisma.workspaceMember.upsert({
    where: { workspaceId_userId: { workspaceId: ws1.id, userId: agentUser.id } },
    update: { role: 'AGENT', status: 'ACTIVE' },
    create: {
      workspaceId: ws1.id,
      userId: agentUser.id,
      role: 'AGENT',
      status: 'ACTIVE',
    },
  });

  // Categories for Workspace 1
  const catPret = await prisma.category.upsert({
    where: { workspaceId_slug: { workspaceId: ws1.id, slug: 'ready-to-wear-pret' } },
    update: { name: 'Ready-to-Wear (Pret)', position: 1 },
    create: {
      workspaceId: ws1.id,
      name: 'Ready-to-Wear (Pret)',
      slug: 'ready-to-wear-pret',
      position: 1,
    },
  });

  const catUnstitched = await prisma.category.upsert({
    where: { workspaceId_slug: { workspaceId: ws1.id, slug: 'unstitched-luxury' } },
    update: { name: 'Unstitched Luxury', position: 2 },
    create: {
      workspaceId: ws1.id,
      name: 'Unstitched Luxury',
      slug: 'unstitched-luxury',
      position: 2,
    },
  });

  const catFestive = await prisma.category.upsert({
    where: { workspaceId_slug: { workspaceId: ws1.id, slug: 'festive-formals' } },
    update: { name: 'Festive Formals', position: 3 },
    create: {
      workspaceId: ws1.id,
      name: 'Festive Formals',
      slug: 'festive-formals',
      position: 3,
    },
  });

  // Product 1: Embroidered Lawn Kurta (with S, M, L, XL variants)
  const prodKurta = await prisma.product.upsert({
    where: { workspaceId_slug: { workspaceId: ws1.id, slug: 'embroidered-black-lawn-kurta' } },
    update: {
      name: 'Embroidered Black Lawn Kurta',
      priceMinor: 450000, // PKR 4,500.00
      salePriceMinor: 399900, // PKR 3,999.00
      sku: 'AC-LWN-BLK-01',
      categoryId: catPret.id,
      status: 'ACTIVE',
      trackInventory: true,
      weightGrams: 350,
      description: 'Pure Egyptian lawn kurta featuring intricate Kashmiri floral threadwork on neckline and sleeves.',
    },
    create: {
      workspaceId: ws1.id,
      name: 'Embroidered Black Lawn Kurta',
      slug: 'embroidered-black-lawn-kurta',
      sku: 'AC-LWN-BLK-01',
      description: 'Pure Egyptian lawn kurta featuring intricate Kashmiri floral threadwork on neckline and sleeves.',
      categoryId: catPret.id,
      status: 'ACTIVE',
      priceMinor: 450000,
      salePriceMinor: 399900,
      currency: 'PKR',
      trackInventory: true,
      weightGrams: 350,
    },
  });

  // Kurta Variants
  const kurtaVariants = [
    { size: 'S', color: 'Black', sku: 'AC-LWN-BLK-01-S', stock: 15, pos: 1 },
    { size: 'M', color: 'Black', sku: 'AC-LWN-BLK-01-M', stock: 25, pos: 2 },
    { size: 'L', color: 'Black', sku: 'AC-LWN-BLK-01-L', stock: 12, pos: 3 },
    { size: 'XL', color: 'Black', sku: 'AC-LWN-BLK-01-XL', stock: 4, pos: 4 },
  ];

  for (const v of kurtaVariants) {
    const variant = await prisma.productVariant.upsert({
      where: { workspaceId_sku: { workspaceId: ws1.id, sku: v.sku } },
      update: { size: v.size, color: v.color, position: v.pos, status: 'ACTIVE' },
      create: {
        workspaceId: ws1.id,
        productId: prodKurta.id,
        sku: v.sku,
        name: `${prodKurta.name} (${v.size})`,
        size: v.size,
        color: v.color,
        status: 'ACTIVE',
        position: v.pos,
      },
    });

    await prisma.inventoryItem.upsert({
      where: { variantId: variant.id },
      update: { available: v.stock, lowStockThreshold: 5 },
      create: {
        workspaceId: ws1.id,
        productId: prodKurta.id,
        variantId: variant.id,
        available: v.stock,
        reserved: 0,
        sold: 0,
        lowStockThreshold: 5,
      },
    });
  }

  // Product 2: Handcrafted Velvet Shawl (No variants, product-level stock)
  const prodShawl = await prisma.product.upsert({
    where: { workspaceId_slug: { workspaceId: ws1.id, slug: 'royal-maroon-velvet-shawl' } },
    update: {
      name: 'Royal Maroon Velvet Shawl',
      priceMinor: 1250000, // PKR 12,500.00
      sku: 'AC-SHW-MRN-01',
      categoryId: catFestive.id,
      status: 'ACTIVE',
      trackInventory: true,
      weightGrams: 800,
      description: 'Micro-velvet heavy zardozi embroidered bridal shawl with antique gold tilla borders.',
    },
    create: {
      workspaceId: ws1.id,
      name: 'Royal Maroon Velvet Shawl',
      slug: 'royal-maroon-velvet-shawl',
      sku: 'AC-SHW-MRN-01',
      description: 'Micro-velvet heavy zardozi embroidered bridal shawl with antique gold tilla borders.',
      categoryId: catFestive.id,
      status: 'ACTIVE',
      priceMinor: 1250000,
      currency: 'PKR',
      trackInventory: true,
      weightGrams: 800,
    },
  });

  const existingShawlStock = await prisma.inventoryItem.findFirst({
    where: { workspaceId: ws1.id, productId: prodShawl.id, variantId: null },
  });
  if (existingShawlStock) {
    await prisma.inventoryItem.update({
      where: { id: existingShawlStock.id },
      data: { available: 8, lowStockThreshold: 2 },
    });
  } else {
    await prisma.inventoryItem.create({
      data: {
        workspaceId: ws1.id,
        productId: prodShawl.id,
        variantId: null,
        available: 8,
        reserved: 0,
        sold: 0,
        lowStockThreshold: 2,
      },
    });
  }

  // Product 3: 3-Piece Chiffon Suit (Unstitched)
  const prodChiffon = await prisma.product.upsert({
    where: { workspaceId_slug: { workspaceId: ws1.id, slug: 'emerald-3pc-chiffon-suit' } },
    update: {
      name: 'Emerald 3-Piece Chiffon Suit',
      priceMinor: 890000, // PKR 8,900.00
      salePriceMinor: 750000, // PKR 7,500.00
      sku: 'AC-CHF-EMR-03',
      categoryId: catUnstitched.id,
      status: 'ACTIVE',
      trackInventory: true,
      description: 'Embroidered pure chiffon shirt with organza dupatta and raw silk trousers.',
    },
    create: {
      workspaceId: ws1.id,
      name: 'Emerald 3-Piece Chiffon Suit',
      slug: 'emerald-3pc-chiffon-suit',
      sku: 'AC-CHF-EMR-03',
      description: 'Embroidered pure chiffon shirt with organza dupatta and raw silk trousers.',
      categoryId: catUnstitched.id,
      status: 'ACTIVE',
      priceMinor: 890000,
      salePriceMinor: 750000,
      currency: 'PKR',
      trackInventory: true,
    },
  });

  const existingChiffonStock = await prisma.inventoryItem.findFirst({
    where: { workspaceId: ws1.id, productId: prodChiffon.id, variantId: null },
  });
  if (existingChiffonStock) {
    await prisma.inventoryItem.update({
      where: { id: existingChiffonStock.id },
      data: { available: 20, lowStockThreshold: 3 },
    });
  } else {
    await prisma.inventoryItem.create({
      data: {
        workspaceId: ws1.id,
        productId: prodChiffon.id,
        variantId: null,
        available: 20,
        reserved: 0,
        sold: 0,
        lowStockThreshold: 3,
      },
    });
  }

  // Tags for Workspace 1
  const tagVIP = await prisma.tag.upsert({
    where: { workspaceId_name: { workspaceId: ws1.id, name: 'VIP Buyer' } },
    update: { color: 'amber' },
    create: { workspaceId: ws1.id, name: 'VIP Buyer', color: 'amber' },
  });

  const tagKarachi = await prisma.tag.upsert({
    where: { workspaceId_name: { workspaceId: ws1.id, name: 'Karachi Local' } },
    update: { color: 'emerald' },
    create: { workspaceId: ws1.id, name: 'Karachi Local', color: 'emerald' },
  });

  const tagCOD = await prisma.tag.upsert({
    where: { workspaceId_name: { workspaceId: ws1.id, name: 'COD Verified' } },
    update: { color: 'blue' },
    create: { workspaceId: ws1.id, name: 'COD Verified', color: 'blue' },
  });

  // Contacts for Workspace 1
  const contactFatima = await prisma.contact.upsert({
    where: { workspaceId_phoneE164: { workspaceId: ws1.id, phoneE164: '+923001234567' } },
    update: {
      name: 'Fatima Sheikh',
      city: 'Karachi',
      status: 'VIP',
      leadStage: 'CONVERTED',
      addressLine1: 'Bungalow 45-B, Khayaban-e-Mujahid, DHA Phase 5',
    },
    create: {
      workspaceId: ws1.id,
      phoneE164: '+923001234567',
      name: 'Fatima Sheikh',
      email: 'fatima.sheikh@example.pk',
      status: 'VIP',
      leadStage: 'CONVERTED',
      city: 'Karachi',
      addressLine1: 'Bungalow 45-B, Khayaban-e-Mujahid, DHA Phase 5',
      assignedToMemberId: ws1AgentMember.id,
      totalOrders: 2,
      totalSpentMinor: 1649900,
    },
  });

  // Attach Tags to Fatima
  await prisma.contactTag.upsert({
    where: { contactId_tagId: { contactId: contactFatima.id, tagId: tagVIP.id } },
    update: {},
    create: { contactId: contactFatima.id, tagId: tagVIP.id },
  });
  await prisma.contactTag.upsert({
    where: { contactId_tagId: { contactId: contactFatima.id, tagId: tagKarachi.id } },
    update: {},
    create: { contactId: contactFatima.id, tagId: tagKarachi.id },
  });

  // Add Contact Note
  await prisma.contactNote.create({
    data: {
      workspaceId: ws1.id,
      contactId: contactFatima.id,
      authorMemberId: ws1OwnerMember.id,
      body: 'High-value customer. Prefers luxury velvet shawls and medium pret sizes. Always fast COD confirmation.',
    },
  });

  const contactUsman = await prisma.contact.upsert({
    where: { workspaceId_phoneE164: { workspaceId: ws1.id, phoneE164: '+923219876543' } },
    update: {
      name: 'Usman Ali',
      city: 'Lahore',
      status: 'ACTIVE',
      leadStage: 'CONVERTED',
      addressLine1: 'House 12, Street 4, Sector Y, DHA',
    },
    create: {
      workspaceId: ws1.id,
      phoneE164: '+923219876543',
      name: 'Usman Ali',
      email: 'usman.ali@example.pk',
      status: 'ACTIVE',
      leadStage: 'CONVERTED',
      city: 'Lahore',
      addressLine1: 'House 12, Street 4, Sector Y, DHA',
      assignedToMemberId: ws1ManagerMember.id,
      totalOrders: 1,
      totalSpentMinor: 424900,
    },
  });

  await prisma.contactTag.upsert({
    where: { contactId_tagId: { contactId: contactUsman.id, tagId: tagCOD.id } },
    update: {},
    create: { contactId: contactUsman.id, tagId: tagCOD.id },
  });

  const contactMariam = await prisma.contact.upsert({
    where: { workspaceId_phoneE164: { workspaceId: ws1.id, phoneE164: '+923335557788' } },
    update: {
      name: 'Mariam Tariq',
      city: 'Islamabad',
      status: 'LEAD',
      leadStage: 'QUALIFIED',
    },
    create: {
      workspaceId: ws1.id,
      phoneE164: '+923335557788',
      name: 'Mariam Tariq',
      email: 'mariam.tariq@example.pk',
      status: 'LEAD',
      leadStage: 'QUALIFIED',
      city: 'Islamabad',
      assignedToMemberId: ws1AgentMember.id,
    },
  });

  // Orders for Workspace 1
  // Order 1: Delivered & Paid Order for Fatima
  const order1 = await prisma.order.upsert({
    where: { workspaceId_orderNumber: { workspaceId: ws1.id, orderNumber: 'ORD-1001' } },
    update: {},
    create: {
      workspaceId: ws1.id,
      orderNumber: 'ORD-1001',
      contactId: contactFatima.id,
      customerName: 'Fatima Sheikh',
      phoneE164: contactFatima.phoneE164,
      addressLine1: 'Bungalow 45-B, Khayaban-e-Mujahid, DHA Phase 5',
      city: 'Karachi',
      country: 'PK',
      status: 'DELIVERED',
      paymentStatus: 'PAID',
      fulfillmentStatus: 'FULFILLED',
      paymentMethod: 'COD',
      currency: 'PKR',
      subtotalMinor: 1250000,
      deliveryFeeMinor: 0, // Free delivery
      discountMinor: 0,
      taxMinor: 0,
      totalMinor: 1250000,
      placedAt: new Date(Date.now() - 7 * 24 * 3600 * 1000),
      confirmedAt: new Date(Date.now() - 6 * 24 * 3600 * 1000),
      shippedAt: new Date(Date.now() - 4 * 24 * 3600 * 1000),
      deliveredAt: new Date(Date.now() - 2 * 24 * 3600 * 1000),
      courierName: 'Trax Logistics',
      trackingNumber: 'TRX-9823190',
      createdByMemberId: ws1AgentMember.id,
      items: {
        create: [
          {
            workspaceId: ws1.id,
            productId: prodShawl.id,
            nameSnapshot: prodShawl.name,
            skuSnapshot: prodShawl.sku,
            unitPriceMinor: 1250000,
            quantity: 1,
            lineSubtotalMinor: 1250000,
          },
        ],
      },
      events: {
        create: [
          {
            workspaceId: ws1.id,
            type: 'order.created',
            toStatus: 'PENDING',
            actorMemberId: ws1AgentMember.id,
            note: 'Order placed via WhatsApp chat inquiry.',
          },
          {
            workspaceId: ws1.id,
            type: 'order.confirmed',
            fromStatus: 'PENDING',
            toStatus: 'CONFIRMED',
            actorMemberId: ws1AgentMember.id,
            note: 'Customer confirmed COD delivery over phone call.',
          },
          {
            workspaceId: ws1.id,
            type: 'order.shipped',
            fromStatus: 'CONFIRMED',
            toStatus: 'SHIPPED',
            actorMemberId: ws1ManagerMember.id,
            note: 'Dispatched with Trax Logistics tracking TRX-9823190.',
          },
          {
            workspaceId: ws1.id,
            type: 'order.delivered',
            fromStatus: 'SHIPPED',
            toStatus: 'DELIVERED',
            note: 'Delivered and cash collected successfully.',
          },
        ],
      },
    },
  });

  // Order 2: In-transit Confirmed Order for Usman
  const kurtaMedVariant = await prisma.productVariant.findFirst({
    where: { workspaceId: ws1.id, sku: 'AC-LWN-BLK-01-M' },
  });

  const order2 = await prisma.order.upsert({
    where: { workspaceId_orderNumber: { workspaceId: ws1.id, orderNumber: 'ORD-1002' } },
    update: {},
    create: {
      workspaceId: ws1.id,
      orderNumber: 'ORD-1002',
      contactId: contactUsman.id,
      customerName: 'Usman Ali',
      phoneE164: contactUsman.phoneE164,
      addressLine1: 'House 12, Street 4, Sector Y, DHA',
      city: 'Lahore',
      country: 'PK',
      status: 'SHIPPED',
      paymentStatus: 'UNPAID',
      fulfillmentStatus: 'PARTIALLY_FULFILLED',
      paymentMethod: 'COD',
      currency: 'PKR',
      subtotalMinor: 399900,
      deliveryFeeMinor: 25000,
      discountMinor: 0,
      taxMinor: 0,
      totalMinor: 424900, // PKR 4,249.00
      placedAt: new Date(Date.now() - 2 * 24 * 3600 * 1000),
      confirmedAt: new Date(Date.now() - 1 * 24 * 3600 * 1000),
      shippedAt: new Date(Date.now() - 12 * 3600 * 1000),
      courierName: 'Call Courier',
      trackingNumber: 'CC-4481029',
      createdByMemberId: ws1OwnerMember.id,
      items: {
        create: [
          {
            workspaceId: ws1.id,
            productId: prodKurta.id,
            variantId: kurtaMedVariant?.id ?? null,
            nameSnapshot: prodKurta.name,
            skuSnapshot: 'AC-LWN-BLK-01-M',
            variantSnapshot: 'Medium / Black',
            unitPriceMinor: 399900,
            quantity: 1,
            lineSubtotalMinor: 399900,
          },
        ],
      },
      events: {
        create: [
          {
            workspaceId: ws1.id,
            type: 'order.created',
            toStatus: 'PENDING',
            actorMemberId: ws1OwnerMember.id,
          },
          {
            workspaceId: ws1.id,
            type: 'order.confirmed',
            fromStatus: 'PENDING',
            toStatus: 'CONFIRMED',
            actorMemberId: ws1OwnerMember.id,
          },
          {
            workspaceId: ws1.id,
            type: 'order.shipped',
            fromStatus: 'CONFIRMED',
            toStatus: 'SHIPPED',
            actorMemberId: ws1ManagerMember.id,
          },
        ],
      },
    },
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 3. WORKSPACE 2: Karachi Electronics (Gadgets / Multi-tenant Proof)
  // ───────────────────────────────────────────────────────────────────────────
  console.log('Seeding Workspace 2: Karachi Electronics...');

  const ws2 = await prisma.workspace.upsert({
    where: { slug: 'karachi-electronics' },
    update: { name: 'Karachi Electronics', currency: 'PKR' },
    create: {
      slug: 'karachi-electronics',
      name: 'Karachi Electronics',
      category: 'Electronics & Gadgets',
      currency: 'PKR',
      timezone: 'Asia/Karachi',
      locale: 'en',
      status: 'ACTIVE',
      onboardingCompletedSteps: ['profile', 'products'],
    },
  });

  // Business Profile for Workspace 2
  await prisma.businessProfile.upsert({
    where: { workspaceId: ws2.id },
    update: {
      legalName: 'Karachi Electronics Hub',
      description: 'Genuine audio gear, smartwatches, power banks, and smartphone accessories.',
      supportPhone: '+923007654321',
      supportEmail: 'sales@karachielectronics.pk',
      addressLine1: 'Shop G-22, Regal Trade Square, Saddar',
      city: 'Karachi',
      country: 'PK',
      deliveryFeeMinor: 20000,
      freeDeliveryThresholdMinor: 300000,
      paymentMethods: ['COD', 'BANK_TRANSFER', 'EASYPAISA'],
    },
    create: {
      workspaceId: ws2.id,
      legalName: 'Karachi Electronics Hub',
      description: 'Genuine audio gear, smartwatches, power banks, and smartphone accessories.',
      supportPhone: '+923007654321',
      supportEmail: 'sales@karachielectronics.pk',
      addressLine1: 'Shop G-22, Regal Trade Square, Saddar',
      city: 'Karachi',
      country: 'PK',
      deliveryFeeMinor: 20000,
      freeDeliveryThresholdMinor: 300000,
      paymentMethods: ['COD', 'BANK_TRANSFER', 'EASYPAISA'],
    },
  });

  // AI agent for Workspace 2 — the second tenant, so cross-workspace isolation of
  // agents and AI turns can be exercised against real rows rather than assumed.
  await ensureSeedAgent(ws2.id, {
    name: 'Bilal',
    role: 'SALES_SUPPORT',
    tone: 'FRIENDLY',
    greeting:
      'Assalamualaikum! Karachi Electronics mein khush aamdeed. Kya dhoond rahe hain — mobile, laptop ya accessories?',
    persona:
      'You help customers of a consumer electronics and gadgets store in Karachi. Direct and practical. Customers ask about specifications, warranty, stock and instalment plans, in English, Urdu and Roman Urdu. State a specification, a price or a warranty term only when a tool or the business knowledge has returned it.',
  });

  // Members for Workspace 2
  await prisma.workspaceMember.upsert({
    where: { workspaceId_userId: { workspaceId: ws2.id, userId: electronicsOwnerUser.id } },
    update: { role: 'OWNER', status: 'ACTIVE' },
    create: {
      workspaceId: ws2.id,
      userId: electronicsOwnerUser.id,
      role: 'OWNER',
      status: 'ACTIVE',
    },
  });

  // Category for Workspace 2
  const catAudio = await prisma.category.upsert({
    where: { workspaceId_slug: { workspaceId: ws2.id, slug: 'wireless-earbuds' } },
    update: { name: 'Wireless Earbuds', position: 1 },
    create: {
      workspaceId: ws2.id,
      name: 'Wireless Earbuds',
      slug: 'wireless-earbuds',
      position: 1,
    },
  });

  // Product in Workspace 2
  const prodEarbuds = await prisma.product.upsert({
    where: { workspaceId_slug: { workspaceId: ws2.id, slug: 'soundcore-anc-earbuds' } },
    update: {
      name: 'Soundcore Active Noise Cancelling Earbuds',
      priceMinor: 750000, // PKR 7,500.00
      salePriceMinor: 649900, // PKR 6,499.00
      sku: 'KE-EAR-ANC-01',
      categoryId: catAudio.id,
      status: 'ACTIVE',
      trackInventory: true,
      description: 'Hybrid ANC earbuds with 36-hour battery life and fast charging.',
    },
    create: {
      workspaceId: ws2.id,
      name: 'Soundcore Active Noise Cancelling Earbuds',
      slug: 'soundcore-anc-earbuds',
      sku: 'KE-EAR-ANC-01',
      description: 'Hybrid ANC earbuds with 36-hour battery life and fast charging.',
      categoryId: catAudio.id,
      status: 'ACTIVE',
      priceMinor: 750000,
      salePriceMinor: 649900,
      currency: 'PKR',
      trackInventory: true,
    },
  });

  const existingEarbudsStock = await prisma.inventoryItem.findFirst({
    where: { workspaceId: ws2.id, productId: prodEarbuds.id, variantId: null },
  });
  if (existingEarbudsStock) {
    await prisma.inventoryItem.update({
      where: { id: existingEarbudsStock.id },
      data: { available: 50, lowStockThreshold: 10 },
    });
  } else {
    await prisma.inventoryItem.create({
      data: {
        workspaceId: ws2.id,
        productId: prodEarbuds.id,
        variantId: null,
        available: 50,
        reserved: 0,
        sold: 0,
        lowStockThreshold: 10,
      },
    });
  }

  // Contact in Workspace 2
  const contactKamran = await prisma.contact.upsert({
    where: { workspaceId_phoneE164: { workspaceId: ws2.id, phoneE164: '+923004445566' } },
    update: {
      name: 'Kamran Siddiqui',
      city: 'Rawalpindi',
      status: 'ACTIVE',
      leadStage: 'CONVERTED',
    },
    create: {
      workspaceId: ws2.id,
      phoneE164: '+923004445566',
      name: 'Kamran Siddiqui',
      email: 'kamran.s@example.pk',
      status: 'ACTIVE',
      leadStage: 'CONVERTED',
      city: 'Rawalpindi',
      totalOrders: 1,
      totalSpentMinor: 669900,
    },
  });

  // Order in Workspace 2
  await prisma.order.upsert({
    where: { workspaceId_orderNumber: { workspaceId: ws2.id, orderNumber: 'ORD-5001' } },
    update: {},
    create: {
      workspaceId: ws2.id,
      orderNumber: 'ORD-5001',
      contactId: contactKamran.id,
      customerName: 'Kamran Siddiqui',
      phoneE164: contactKamran.phoneE164,
      addressLine1: 'Apartment 402, Askari 14',
      city: 'Rawalpindi',
      country: 'PK',
      status: 'CONFIRMED',
      paymentStatus: 'UNPAID',
      fulfillmentStatus: 'UNFULFILLED',
      paymentMethod: 'COD',
      currency: 'PKR',
      subtotalMinor: 649900,
      deliveryFeeMinor: 20000,
      discountMinor: 0,
      taxMinor: 0,
      totalMinor: 669900,
      placedAt: new Date(Date.now() - 1 * 24 * 3600 * 1000),
      confirmedAt: new Date(),
      items: {
        create: [
          {
            workspaceId: ws2.id,
            productId: prodEarbuds.id,
            nameSnapshot: prodEarbuds.name,
            skuSnapshot: prodEarbuds.sku,
            unitPriceMinor: 649900,
            quantity: 1,
            lineSubtotalMinor: 649900,
          },
        ],
      },
      events: {
        create: [
          {
            workspaceId: ws2.id,
            type: 'order.created',
            toStatus: 'PENDING',
          },
          {
            workspaceId: ws2.id,
            type: 'order.confirmed',
            fromStatus: 'PENDING',
            toStatus: 'CONFIRMED',
          },
        ],
      },
    },
  });

  console.log('✅ Seed completed successfully!');
  console.log(`- Seeded Workspace 1: ${ws1.name} (${ws1.slug})`);
  console.log(`- Seeded Workspace 2: ${ws2.name} (${ws2.slug})`);
  console.log(`- Demo Login: ahmed@akmalcouture.pk / ${DEMO_PASSWORD}`);
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
