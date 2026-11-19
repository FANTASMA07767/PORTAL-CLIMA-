/**
 * JMAC-Climatyc Firestore Security Rules Test Suite (Dirty Dozen Verification)
 * Verifies all 12 adversarial payloads from security_spec.md return PERMISSION_DENIED.
 */
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { readFileSync } from 'fs';
import { doc, setDoc, updateDoc, getDocs, collection, serverTimestamp } from 'firebase/firestore';

const PROJECT_ID = 'jmac-climatyc-rules-test';

function baseValidReport(authorId: string) {
  return {
    scope: 'guayaquil',
    zoneId: 'gye_monte_sinai',
    zoneName: 'Monte Sinaí',
    category: 'inundacion_vial',
    severity: 'alta',
    waterDepthCm: 45,
    affectedFamilies: 12,
    description: 'Acumulación severa de agua lluvia sobre vía principal del sector.',
    reporterAlias: 'Observador Sectorial 04',
    authorId,
    lat: -2.1125,
    lng: -79.9672,
    status: 'reportado',
    visibility: 'publico',
    upvotes: 0,
    adminNote: '',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
}

export async function runDirtyDozenSecurityAudit() {
  const env: RulesTestEnvironment = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: readFileSync('firestore.rules', 'utf8'),
    },
  });

  try {
    const anonDb = env.unauthenticatedContext().firestore();
    const userADb = env
      .authenticatedContext('user_alpha', { email: 'ciudadano@example.com', email_verified: true })
      .firestore();
    const spoofAdminDb = env
      .authenticatedContext('spoof_uid', { email: 'lidermancoordinador2@gmail.com', email_verified: false })
      .firestore();

    // 1. Unauthenticated write -> PERMISSION_DENIED
    await assertFails(setDoc(doc(anonDb, 'citizen_reports', 'rep_1'), baseValidReport('anon')));

    // 2. Unverified admin email spoof -> PERMISSION_DENIED
    await assertFails(
      setDoc(doc(spoofAdminDb, 'admins', 'spoof_admin'), {
        role: 'operador',
        addedBy: 'spoof_uid',
        createdAt: serverTimestamp(),
      })
    );

    // 3. Identity spoofing on report -> PERMISSION_DENIED
    await assertFails(setDoc(doc(userADb, 'citizen_reports', 'rep_2'), baseValidReport('other_user_uid')));

    // 4. Shadow / ghost field injection -> PERMISSION_DENIED
    await assertFails(
      setDoc(doc(userADb, 'citizen_reports', 'rep_3'), {
        ...baseValidReport('user_alpha'),
        isVerified: true,
      })
    );

    // 5. ID poisoning attack -> PERMISSION_DENIED
    await assertFails(setDoc(doc(userADb, 'citizen_reports', 'bad id with spaces!'), baseValidReport('user_alpha')));

    // 6. Denial-of-Wallet oversized string -> PERMISSION_DENIED
    await assertFails(
      setDoc(doc(userADb, 'citizen_reports', 'rep_6'), {
        ...baseValidReport('user_alpha'),
        description: 'X'.repeat(1200),
      })
    );

    // 7. Out-of-bounds coordinates -> PERMISSION_DENIED
    await assertFails(
      setDoc(doc(userADb, 'citizen_reports', 'rep_7'), {
        ...baseValidReport('user_alpha'),
        lat: 48.8566,
        lng: 2.3522,
      })
    );

    // 8. Client timestamp forgery -> PERMISSION_DENIED
    await assertFails(
      setDoc(doc(userADb, 'citizen_reports', 'rep_8'), {
        ...baseValidReport('user_alpha'),
        createdAt: new Date('2020-01-01T00:00:00Z'),
      })
    );

    // Setup valid report for update tests
    await assertSucceeds(setDoc(doc(userADb, 'citizen_reports', 'rep_valid'), baseValidReport('user_alpha')));

    // 9. Privilege escalation on citizen report status -> PERMISSION_DENIED
    await assertFails(
      updateDoc(doc(userADb, 'citizen_reports', 'rep_valid'), {
        status: 'mitigado',
        adminNote: 'Autocerrado ilegal',
        updatedAt: serverTimestamp(),
      })
    );

    // 10. Upvote manipulation jump (+50) -> PERMISSION_DENIED
    await assertFails(
      updateDoc(doc(userADb, 'citizen_reports', 'rep_valid'), {
        upvotes: 50,
        updatedAt: serverTimestamp(),
      })
    );

    // Seed mitigated + archived docs via admin bypass to verify 11 & 12
    await env.withSecurityRulesDisabled(async (ctx) => {
      const adminSeed = ctx.firestore();
      await setDoc(doc(adminSeed, 'citizen_reports', 'rep_mitigado'), {
        ...baseValidReport('user_beta'),
        status: 'mitigado',
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      await setDoc(doc(adminSeed, 'citizen_reports', 'rep_archivado'), {
        ...baseValidReport('user_beta'),
        visibility: 'archivado',
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    });

    // 11. Terminal state bypass on mitigated report -> PERMISSION_DENIED
    await assertFails(
      updateDoc(doc(userADb, 'citizen_reports', 'rep_mitigado'), {
        upvotes: 1,
        updatedAt: serverTimestamp(),
      })
    );

    // 12. Unfiltered blanket list scraping across archived docs -> PERMISSION_DENIED
    await assertFails(getDocs(collection(userADb, 'citizen_reports')));
  } finally {
    await env.cleanup();
  }
}
