"use strict";

require("dotenv").config();

const admin = require("firebase-admin");

const GOVERNORATES = [
  { code: "CAI", name: "القاهرة", nameEn: "Cairo" },
  { code: "GIZ", name: "الجيزة", nameEn: "Giza" },
  { code: "ALX", name: "الإسكندرية", nameEn: "Alexandria" },
  { code: "DKA", name: "الدقهلية", nameEn: "Dakahlia" },
  { code: "RED", name: "البحر الأحمر", nameEn: "Red Sea" },
  { code: "BHE", name: "البحيرة", nameEn: "Beheira" },
  { code: "FAY", name: "الفيوم", nameEn: "Fayoum" },
  { code: "GHR", name: "الغربية", nameEn: "Gharbia" },
  { code: "ISM", name: "الإسماعيلية", nameEn: "Ismailia" },
  { code: "MNF", name: "المنوفية", nameEn: "Monufia" },
  { code: "MNZ", name: "المنيا", nameEn: "Minya" },
  { code: "QAL", name: "القليوبية", nameEn: "Qalyubia" },
  { code: "WAD", name: "الوادي الجديد", nameEn: "New Valley" },
  { code: "SUZ", name: "السويس", nameEn: "Suez" },
  { code: "ASN", name: "أسوان", nameEn: "Aswan" },
  { code: "AST", name: "أسيوط", nameEn: "Assiut" },
  { code: "BHR", name: "البحيرة", nameEn: "Beheira" },
  { code: "BNS", name: "بني سويف", nameEn: "Beni Suef" },
  { code: "PTS", name: "بورسعيد", nameEn: "Port Said" },
  { code: "DTM", name: "دمياط", nameEn: "Damietta" },
  { code: "SHG", name: "سوهاج", nameEn: "Sohag" },
  { code: "SIN", name: "شمال سيناء", nameEn: "North Sinai" },
  { code: "JSS", name: "جنوب سيناء", nameEn: "South Sinai" },
  { code: "KFS", name: "كفر الشيخ", nameEn: "Kafr El Sheikh" },
  { code: "MTB", name: "مطروح", nameEn: "Matrouh" },
  { code: "LUX", name: "الأقصر", nameEn: "Luxor" },
  { code: "QNA", name: "قنا", nameEn: "Qena" },
];

const CITIES = {
  CAI: ["مدينة نصر", "المعادي", "حلوان", "شبرا", "الزمالك", "مصر الجديدة", "التجمع الخامس", "العباسية", "السلام", "المرج"],
  GIZ: ["الدقي", "المهندسين", "الهرم", "فيصل", "6 أكتوبر", "الشيخ زايد", "إمبابة", "البدرشين", "العياط", "أوسيم"],
  ALX: ["المنتزه", "سيدي جابر", "العجمي", "المعمورة", "برج العرب", "كرموز", "العطارين", "المنشية", "سموحة", "محرم بك"],
  DKA: ["المنصورة", "طلخا", "ميت غمر", "دكرنس", "بلقاس", "منية النصر", "السنبلاوين", "تمي الأمديد", "الجمالية", "شربين"],
  RED: ["الغردقة", "سفاجا", "القصير", "مرسى علم", "رأس غارب", "الشلاتين", "حلايب"],
  BHE: ["دمنهور", "كفر الدوار", "رشيد", "إيتاي البارود", "أبو المطامير", "الدلنجات", "المحمودية", "إدكو", "أبو حمص"],
  FAY: ["الفيوم", "سنورس", "إطسا", "طامية", "أبشواي", "يوسف الصديق"],
  GHR: ["طنطا", "المحلة الكبرى", "كفر الزيات", "زفتى", "السنطة", "بسيون", "قطور", "سمنود"],
  ISM: ["الإسماعيلية", "فايد", "القنطرة شرق", "القنطرة غرب", "أبو صوير", "التل الكبير"],
  MNF: ["شبين الكوم", "منوف", "أشمون", "الباجور", "قويسنا", "بركة السبع", "تلا", "الشهداء", "السادات"],
  MNZ: ["المنيا", "ملوي", "بني مزار", "مطاي", "سمالوط", "العدوة", "دير مواس", "أبو قرقاص"],
  QAL: ["بنها", "شبرا الخيمة", "القناطر الخيرية", "قليوب", "الخانكة", "كفر شكر", "طوخ", "شبين القناطر"],
  WAD: ["الخارجة", "الداخلة", "الفرافرة", "باريس", "بلاط"],
  SUZ: ["السويس", "الأربعين", "عتاقة", "فيصل", "الجناين"],
  ASN: ["أسوان", "كوم أمبو", "إدفو", "دراو", "نصر النوبة", "أبو سمبل", "كلابشة"],
  AST: ["أسيوط", "أبنوب", "الفتح", "منفلوط", "القوصية", "ديروط", "أبو تيج", "الغنايم", "ساحل سليم", "البداري"],
  BNS: ["بني سويف", "الواسطى", "ناصر", "إهناسيا", "ببا", "الفشن", "سمسطا"],
  PTS: ["بورسعيد", "الزهور", "المناخ", "الشرق", "الضواحي", "الجنوب", "بورفؤاد"],
  DTM: ["دمياط", "دمياط الجديدة", "رأس البر", "فارسكور", "كفر سعد", "الزرقا", "كفر البطيخ"],
  SHG: ["سوهاج", "طهطا", "جرجا", "أخميم", "المنشاة", "المراغة", "ساقلته", "دار السلام", "جهينة", "البلينا"],
  SIN: ["العريش", "بئر العبد", "الشيخ زويد", "رفح", "نخل", "الحسنة"],
  JSS: ["شرم الشيخ", "طور سيناء", "دهب", "نويبع", "طابا", "سانت كاترين", "أبو رديس", "أبو زنيمة"],
  KFS: ["كفر الشيخ", "دسوق", "فوه", "مطوبس", "بلطيم", "سيدي سالم", "الرياض", "الحامول", "بيلا"],
  MTB: ["مرسى مطروح", "الحمام", "العلمين", "الضبعة", "سيدي براني", "السلوم", "سيوة"],
  LUX: ["الأقصر", "إسنا", "أرمنت", "البياضية", "القرنة", "الطود"],
  QNA: ["قنا", "نجع حمادي", "دشنا", "قفط", "قوص", "فرشوط", "أبو تشت", "الوقف"],
};

const initFirebase = () => {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: (process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n"),
    }),
  });
  return admin.firestore();
};

const seedGovernorates = async (db) => {
  const batch = db.batch();
  let created = 0;

  for (const g of GOVERNORATES) {
    const docId = g.code.toLowerCase();
    const ref = db.collection("governorates").doc(docId);
    const snap = await ref.get();
    if (!snap.exists) {
      batch.set(ref, {
        name: g.name,
        nameEn: g.nameEn,
        code: g.code,
        active: true,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      created++;
    }
  }

  await batch.commit();
  console.log(`Governorates: created ${created}, total ${GOVERNORATES.length}`);
};

const seedCities = async (db) => {
  let created = 0;
  let total = 0;

  for (const [govCode, cities] of Object.entries(CITIES)) {
    const govId = govCode.toLowerCase();
    for (const cityName of cities) {
      total++;
      const docId = `${govId}_${cityName.replace(/\s+/g, "_")}`;
      const ref = db.collection("cities").doc(docId);
      const snap = await ref.get();
      if (!snap.exists) {
        await ref.set({
          name: cityName,
          governorateId: govId,
          active: true,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        created++;
      }
    }
  }

  console.log(`Cities: created ${created}, total ${total}`);
};

const seedTransportTypes = async (db) => {
  const types = [
    { slug: "metro",      name: "مترو" },
    { slug: "microbus",   name: "ميكروباص" },
    { slug: "bus",        name: "أتوبيس" },
    { slug: "train",      name: "قطار" },
    { slug: "taxi",       name: "تاكسي" },
    { slug: "tram",       name: "ترام" },
    { slug: "monorail",   name: "مونوريل" },
    { slug: "brt",        name: "أتوبيس ترددي BRT" },
    { slug: "toktok",     name: "توك توك" },
    { slug: "other",      name: "أخرى" },
  ];

  let created = 0;
  for (const t of types) {
    const ref = db.collection("transportTypes").doc(t.slug);
    const snap = await ref.get();
    if (!snap.exists) {
      await ref.set({
        name: t.name,
        slug: t.slug,
        active: true,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      created++;
    }
  }
  console.log(`Transport types: created ${created}, total ${types.length}`);
};

const main = async () => {
  const required = ["FIREBASE_PROJECT_ID", "FIREBASE_CLIENT_EMAIL", "FIREBASE_PRIVATE_KEY"];
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length) {
    console.error(`Missing env vars: ${missing.join(", ")}`);
    process.exit(1);
  }

  const db = initFirebase();
  await seedGovernorates(db);
  await seedCities(db);
  await seedTransportTypes(db);
  console.log("Seed complete.");
  process.exit(0);
};

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});