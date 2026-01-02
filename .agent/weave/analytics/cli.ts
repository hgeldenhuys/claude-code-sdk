
import { weave } from '../index';
import { WeaveAnalytics } from './engine';

async function main() {
  console.log('🔮 Weave Analytics Engine v1.0');
  console.log('==============================');
  
  // 1. Load Knowledge
  process.stdout.write('📥 Loading Weave knowledge... ');
  const knowledge = await weave.load();
  console.log(`Done.`);
  console.log(`   - Ontology Entities: ${Object.keys(knowledge.ontology.entities).length}`);
  console.log(`   - Ontology Relations: ${Object.keys(knowledge.ontology.relations).length}`);
  console.log(`   - Pain Points: ${Object.keys(knowledge.qualia.painPoints).length}`);
  console.log(`   - Best Practices: ${Object.keys(knowledge.qualia.bestPractices || {}).length}`);
  console.log(`   - Patterns: ${Object.keys(knowledge.epistemology.patterns).length}`);
  console.log(`   - Knowledge Items: ${Object.keys(knowledge.epistemology.knowledge).length}`);

  // 2. Ingest into SQL
  process.stdout.write('⚙️  Ingesting into Analytics Engine... ');
  const analytics = new WeaveAnalytics();
  await analytics.ingest(knowledge);
  console.log('Done.\n');

  // 3. Generate Insights
  
  // --- Profile 1: Technical Debt ---
  const techDebt = analytics.getTechnicalDebtProfile();
  console.log('🔥 Technical Debt Heatmap (Top 5)');
  console.log('   Formula: High Pain + Low Confidence + High Churn');
  if (techDebt.length === 0) {
    console.log('   ✅ No significant technical debt detected.');
  } else {
    techDebt.slice(0, 5).forEach(item => {
      console.log(`   • [${item.riskScore.toFixed(1)}] ${item.name} (Conf: ${(item.confidence*100).toFixed(0)}%, Pain: ${item.painScore})`);
    });
  }
  console.log('');

  // --- Profile 2: Knowledge Silos ---
  const silos = analytics.getKnowledgeSilos();
  console.log('🧠 Knowledge Silos (Top 5)');
  console.log('   Formula: Exclusive touchpoints per session/user');
  if (silos.length === 0) {
    console.log('   ✅ Knowledge is well-distributed.');
  } else {
    silos.forEach(item => {
      const icon = item.riskLevel === 'high' ? '⚠️ ' : '  ';
      console.log(`   ${icon} ${item.owner.substring(0, 8)}... : ${item.exclusiveKnowledge} exclusive items`);
    });
  }
  console.log('');

  // --- Profile 3: Zombie Code ---
  const zombies = analytics.getZombieCode();
  console.log('🧟 Zombie Code Candidates');
  console.log('   Formula: Untouched + Low Confidence');
  if (zombies.length === 0) {
    console.log('   ✅ No zombie code detected.');
  } else {
    zombies.slice(0, 5).forEach(item => {
      console.log(`   • ${item.componentId} (Untouched)`);
    });
  }
  console.log('');
  
  // --- Profile 4: Alignment Orphans ---
  const orphans = analytics.getAlignmentStats() as any[];
  console.log('🕸️  Network Health');
  console.log(`   • Orphaned Entities: ${orphans.length} (entities with no relations)`);
  if (orphans.length > 0) {
    console.log(`     Examples: ${orphans.slice(0, 3).map(o => o.name).join(', ')}`);
  }
  console.log('');

  // --- Profile 5: Bayesian Knowledge Health ---
  const factsNeedingAttention = await weave.getFactsNeedingAttention();
  const totalFacts = Object.keys(knowledge.epistemology.knowledge).length;

  console.log('📊 Bayesian Knowledge Health');
  if (totalFacts === 0) {
    console.log('   ℹ️  No tracked facts yet. Use /weave:observe to record facts.');
  } else {
    // Show confidence distribution
    const facts = Object.values(knowledge.epistemology.knowledge);
    const highConf = facts.filter(f => f.confidence >= 0.85).length;
    const medConf = facts.filter(f => f.confidence >= 0.5 && f.confidence < 0.85).length;
    const lowConf = facts.filter(f => f.confidence < 0.5).length;

    console.log(`   Confidence Distribution:`);
    console.log(`     🟢 High (≥85%): ${highConf} facts`);
    console.log(`     🟡 Medium (50-85%): ${medConf} facts`);
    console.log(`     🔴 Low (<50%): ${lowConf} facts`);
    console.log('');

    // Facts needing attention
    if (factsNeedingAttention.lowConfidence.length > 0) {
      console.log('   ⚠️  Low Confidence (needs validation):');
      for (const f of factsNeedingAttention.lowConfidence.slice(0, 3)) {
        console.log(`      • ${f.id} (${(f.confidence * 100).toFixed(0)}%)`);
      }
    }

    if (factsNeedingAttention.stale.length > 0) {
      console.log('   ⏰ Stale (not seen in 30+ days):');
      for (const f of factsNeedingAttention.stale.slice(0, 3)) {
        console.log(`      • ${f.id}`);
      }
    }

    if (factsNeedingAttention.contradicted.length > 0) {
      console.log('   ❌ Contradicted (unresolved):');
      for (const f of factsNeedingAttention.contradicted.slice(0, 3)) {
        console.log(`      • ${f.id}`);
      }
    }

    if (factsNeedingAttention.lowConfidence.length === 0 &&
        factsNeedingAttention.stale.length === 0 &&
        factsNeedingAttention.contradicted.length === 0) {
      console.log('   ✅ All facts healthy!');
    }
  }

  analytics.close();
}

main().catch(console.error);
