import { Hero } from '@/components/marketing/hero';
import { AiSafety } from '@/components/marketing/sections/ai-safety';
import { Capabilities } from '@/components/marketing/sections/capabilities';
import { FaqSection } from '@/components/marketing/sections/faq-section';
import { FinalCta } from '@/components/marketing/sections/final-cta';
import { PricingTeaser } from '@/components/marketing/sections/pricing-teaser';
import { ProblemLedger } from '@/components/marketing/sections/problem-ledger';
import { ProofBand } from '@/components/marketing/sections/proof-band';
import { WorkflowSection } from '@/components/marketing/sections/workflow-section';

/**
 * The landing page, as a composition.
 *
 * The order is one argument in five moves: here is your evening (hero, proof, ledger), here is
 * the same evening handled (workflow), here is why you can trust it with a customer (AI safety),
 * here is everything else in the box (capabilities), and here is what it costs (pricing, FAQ,
 * ask).
 *
 * Sections alternate between the contrast band and the plain page, and that alternation is doing
 * work rather than decoration: every band is a claim about the product, every plain section is a
 * demonstration of it, so the page has a rhythm a reader can feel before they have read a word.
 * The band follows the theme — near-black in dark, a deeper wash of the brand tint in light — so
 * the rhythm survives the theme switch instead of collapsing into a dark page with light holes.
 *
 * Each section owns its own copy and its own file. Nothing here but the running order — a page
 * that also held the words would be six hundred lines, and the section that needed editing would
 * always be the one in the middle.
 */
export default function LandingPage() {
  return (
    <>
      <Hero />
      <ProofBand />
      <ProblemLedger />
      <WorkflowSection />
      <AiSafety />
      <Capabilities />
      <PricingTeaser />
      <FaqSection />
      <FinalCta />
    </>
  );
}
