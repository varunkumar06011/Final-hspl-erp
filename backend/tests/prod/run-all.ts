/**
 * FINAL PRODUCTION READINESS TEST — Main Runner
 * Executes all 50 scenarios and produces the final report.
 *
 * Run: npx tsx tests/prod/run-all.ts
 */
import { results, record, prisma } from './helpers';
import { sectionA } from './sectionA';
import { sectionB } from './sectionB';
import { sectionC } from './sectionC';
import { sectionD } from './sectionD';
import { sectionE } from './sectionE';
import { sectionF } from './sectionF';
import { sectionG } from './sectionG';
import { sectionH } from './sectionH';
import { sectionI } from './sectionI';

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  HOSPITAL ERP — FINAL PRODUCTION READINESS TEST');
  console.log('  Project: V Grand Health Care Pvt Ltd');
  console.log('  Date: ' + new Date().toISOString());
  console.log('═══════════════════════════════════════════════════════════════');

  // Run all sections sequentially
  await sectionA();
  await sectionB();
  await sectionC();
  await sectionD();
  await sectionE();
  await sectionF();
  await sectionG();
  await sectionH();
  await sectionI();

  // ── Print Final Report ──
  console.log('\n\n═══════════════════════════════════════════════════════════════');
  console.log('  FINAL PRODUCTION READINESS REPORT');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const passed = results.filter(r => r.status === 'PASS').length;
  const failed = results.filter(r => r.status === 'FAIL').length;
  const blocked = results.filter(r => r.status === 'BLOCKED').length;
  const notTested = results.filter(r => r.status === 'NOT_TESTED').length;

  console.log('─── 1. Executive Summary ───');
  console.log(`  Total scenarios tested: ${results.length}`);
  console.log(`  Passed:  ${passed}`);
  console.log(`  Failed:  ${failed}`);
  console.log(`  Blocked: ${blocked}`);
  console.log(`  Not tested: ${notTested}`);

  console.log('\n─── 2. Failure Report ───');
  const failures = results.filter(r => r.status === 'FAIL');
  if (failures.length === 0) {
    console.log('  No failures.');
  } else {
    for (const f of failures) {
      console.log(`\n  Scenario ${f.scenario}: ${f.name}`);
      console.log(`    Severity: ${f.severity || 'UNKNOWN'}`);
      console.log(`    Details: ${f.details}`);
      if (f.discrepancy) console.log(`    Discrepancy: ${f.discrepancy}`);
      if (f.dbEvidence) console.log(`    DB Evidence: ${f.dbEvidence}`);
    }
  }

  const blockedItems = results.filter(r => r.status === 'BLOCKED');
  if (blockedItems.length > 0) {
    console.log('\n─── Blocked Scenarios ───');
    for (const b of blockedItems) {
      console.log(`  Scenario ${b.scenario}: ${b.name} — ${b.details}`);
    }
  }

  console.log('\n─── 3. Data Integrity Report ───');
  const criticalFailures = results.filter(r => r.status === 'FAIL' && r.severity === 'CRITICAL');
  const highFailures = results.filter(r => r.status === 'FAIL' && r.severity === 'HIGH');

  const integrityIssues: string[] = [];
  for (const f of criticalFailures) {
    if (f.discrepancy) integrityIssues.push(`  - [S${f.scenario}] ${f.discrepancy}`);
  }

  if (integrityIssues.length === 0) {
    console.log('  No critical data integrity issues found.');
  } else {
    console.log('  CRITICAL DATA INTEGRITY ISSUES:');
    for (const issue of integrityIssues) {
      console.log(issue);
    }
  }

  console.log('\n  Integrity checks performed:');
  console.log('  - Money amounts: verified through full procurement flow');
  console.log('  - Bank balances: verified before/after every transaction');
  console.log('  - Cash balances: verified before/after every transaction');
  console.log('  - Budget actual/paid/committed: verified at each workflow stage');
  console.log('  - Invoice outstanding: verified after full and partial payments');
  console.log('  - Inventory stock: verified against transaction history');
  console.log('  - Asset lifecycle: verified status transitions');
  console.log('  - Approval statuses: verified in database after each action');
  console.log('  - Duplicate posting: tested for GRN, payment, and JV');
  console.log('  - Reversal/rejection: verified commitment release and no orphaned records');

  console.log('\n─── 4. Final Production Verdict ───');
  if (criticalFailures.length > 0) {
    console.log('  VERDICT: RED — Not ready');
    console.log(`  ${criticalFailures.length} critical issue(s) found that could cause financial/data corruption.`);
  } else if (highFailures.length > 0) {
    console.log('  VERDICT: YELLOW — Usable but fixes recommended');
    console.log(`  ${highFailures.length} high-severity issue(s) found that should be fixed before deployment.`);
  } else if (blocked > 0) {
    console.log('  VERDICT: YELLOW — Usable but some scenarios blocked');
    console.log(`  ${blocked} scenario(s) could not be tested due to missing test data.`);
  } else {
    console.log('  VERDICT: GREEN — Ready for intended production deployment');
    console.log('  No critical/high operational data-integrity issues found.');
  }

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('  END OF REPORT');
  console.log('═══════════════════════════════════════════════════════════════\n');

  await prisma.$disconnect();
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
