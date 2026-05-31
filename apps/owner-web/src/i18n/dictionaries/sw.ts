/**
 * GENERATED — do not edit by hand.
 *
 * Swahili mirror of `en.ts`, produced by `scripts/i18n-generate-sw.ts`
 * (Claude tier-1, contamination-checked). Run `pnpm i18n:gen` after
 * editing en.ts to regenerate.
 */

export const sw = {
  "common": {
    "appName": "Borjie",
    "loading": "Inapakia…",
    "retry": "Jaribu tena",
    "cancel": "Ghairi",
    "save": "Hifadhi",
    "close": "Funga",
    "back": "Rudi",
    "next": "Ifuatayo",
    "continue": "Endelea",
    "submit": "Wasilisha",
    "error": "Kuna hitilafu imetokea."
  },
  "auth": {
    "signIn": {
      "eyebrow": "Kokpiti ya Mmiliki",
      "heading": "Karibu tena.",
      "subheading": "Ingia ili kuendelea kwenye kokpiti yako.",
      "emailLabel": "Barua pepe",
      "passwordLabel": "Nywila",
      "submit": "Ingia",
      "submitting": "Inaingia…",
      "footer": "Mnyororo wa ukaguzi · lugha mbili · Mkazi wa Tanzania",
      "errorInvalidEmail": "Weka anwani sahihi ya barua pepe",
      "errorPasswordRequired": "Nywila inahitajika",
      "errorInvalidInput": "Maelezo si sahihi",
      "errorSignInFailed": "Kuingia kumeshindikana. Angalia maelezo yako.",
      "errorNetwork": "Haikuweza kufikia API ya Borjie."
    }
  },
  "signup": {
    "page": {
      "heading": "Karibu Borjie.",
      "subheading": "Jisajili ili kuanza kusimamia shughuli zako za madini.",
      "title": "Jisajili",
      "eyebrow": "Kokpiti ya Mmiliki"
    },
    "wizard": {
      "stepsAriaLabel": "Hatua za usajili",
      "stepKind": "Aina",
      "stepDetails": "Maelezo",
      "stepConfirm": "Thibitisha"
    },
    "kind": {
      "question": "Ungependa kujisajili vipi?",
      "individualTitle": "Mimi ni mchimbaji binafsi",
      "individualSubtitle": "Mchimbaji wa ufundi au mmiliki wa PML moja.",
      "individualBullet1": "Jina kamili na simu",
      "individualBullet2": "Barua pepe",
      "individualBullet3": "Nambari ya leseni (PML) — si lazima",
      "individualBullet4": "Kitambulisho cha taifa cha NIDA — si lazima",
      "businessTitle": "Nina kampuni iliyosajiliwa",
      "businessSubtitle": "Kampuni iliyosajiliwa na BRELA au mmiliki wa PL/ML.",
      "businessBullet1": "Jina la kampuni + nambari ya BRELA",
      "businessBullet2": "Nambari ya TIN",
      "businessBullet3": "Jina la mmiliki, simu, na barua pepe",
      "businessBullet4": "Nambari ya leseni (PML/PL/ML) — si lazima"
    },
    "individual": {
      "heading": "Maelezo yako binafsi"
    },
    "business": {
      "heading": "Maelezo ya kampuni yako"
    },
    "field": {
      "fullName": "Jina kamili",
      "country": "Nchi",
      "phone": "Simu",
      "email": "Barua pepe",
      "language": "Lugha",
      "currency": "Sarafu",
      "miningLicence": "Leseni ya madini (PML)",
      "miningLicenceBusiness": "Leseni ya madini (PML/PL/ML)",
      "nationalId": "Kitambulisho cha taifa cha NIDA",
      "orgName": "Jina la kampuni",
      "businessReg": "Nambari ya BRELA",
      "taxId": "Nambari ya TIN",
      "ownerName": "Jina la mmiliki",
      "ownerPhone": "Simu ya mmiliki",
      "ownerEmail": "Barua pepe ya mmiliki",
      "vat": "Nambari ya VAT",
      "optional": "(si lazima)"
    },
    "validation": {
      "fullNameRequired": "Jina kamili linahitajika",
      "orgNameRequired": "Jina la kampuni linahitajika",
      "brelaRequired": "Nambari ya BRELA inahitajika",
      "tinRequired": "Nambari ya TIN inahitajika",
      "ownerNameRequired": "Jina la mmiliki linahitajika",
      "phoneInvalid": "Weka simu halali (mfano +255712345678)",
      "emailInvalid": "Weka barua pepe halali"
    },
    "nav": {
      "back": "‹ Rudi",
      "next": "Endelea ›",
      "continue": "Endelea"
    },
    "contact": {
      "heading": "Thibitisha na hakiki",
      "labelType": "Aina",
      "labelSummary": "Muhtasari",
      "labelOwner": "Mmiliki",
      "labelPhone": "Simu",
      "labelEmail": "Barua pepe",
      "sendOtp": "Tuma OTP kwenye simu yangu",
      "submitting": "Inatuma…",
      "otpLabel": "OTP imetumwa kwa {phone}",
      "verify": "Hakiki",
      "verifying": "Inahakiki…",
      "tryAgain": "Jaribu tena",
      "errorSignupFailed": "Usajili umeshindwa",
      "errorBadResponse": "Jibu batili kutoka kwa seva",
      "errorNetwork": "Haikuweza kufikia seva",
      "errorOtpInvalid": "Weka msimbo halali wa OTP",
      "errorOtpVerify": "Haikuweza kuhakiki OTP"
    }
  },
  "dashboard": {
    "greetingMorning": "Habari za asubuhi, {name}",
    "greetingAfternoon": "Habari za mchana, {name}",
    "greetingEvening": "Habari za jioni, {name}",
    "subtitle": "Hii hapa ni mali yako kwa muhtasari.",
    "emptyState": "Hakuna cha kuonyesha bado."
  },
  "nav": {
    "dashboard": "Dashibodi",
    "cockpit": "Kokpiti",
    "finance": "Fedha",
    "treasury": "Hazina",
    "workforce": "Wafanyakazi",
    "compliance": "Uzingatiaji",
    "marketplace": "Soko",
    "settings": "Mipangilio",
    "notifications": "Arifa"
  }
} as const;
