import type { LocalizedMessage } from "./types.js";

/**
 * CODE -> { en, sw } catalog for every USER-REACHABLE 4xx gateway error code
 * (conflict / validation / auth / not-found / rate-limit / domain-rule).
 *
 * Codes that are 5xx-infra (*_FAILED / *_UNAVAILABLE / *_ERROR / DB_* /
 * DATABASE_*) or internal/not-implemented/not-configured are DELIBERATELY
 * ABSENT — `localizeApiError` routes them to the single generic localized
 * fallback so no raw English ever reaches the user.
 *
 * Parity is absolute: every entry carries BOTH `en` and `sw`, and the parity
 * gate fails the build on any empty value or any accidental `sw === en`
 * passthrough on a translatable code.
 *
 * Swahili is native-quality and matches the repo glossary (formal register, no
 * Sheng): Leseni = licence, Kibali = permit, Kikao = session, Ruhusa =
 * permission, Mrabaha = royalty, Tenant -> Shirika/Taasisi.
 */
export const ERROR_MESSAGES: Readonly<Record<string, LocalizedMessage>> = {
  // ── Authentication / session ───────────────────────────────────────────
  AUTH: {
    en: "Please sign in to continue.",
    sw: "Tafadhali ingia ili kuendelea.",
  },
  AUTH_REQUIRED: {
    en: "Please sign in to continue.",
    sw: "Tafadhali ingia ili kuendelea.",
  },
  UNAUTHENTICATED: {
    en: "Please sign in to continue.",
    sw: "Tafadhali ingia ili kuendelea.",
  },
  NO_SESSION: {
    en: "Your session has ended. Please sign in again.",
    sw: "Kikao chako kimekwisha. Tafadhali ingia tena.",
  },
  SESSION_NOT_FOUND: {
    en: "Your session has ended. Please sign in again.",
    sw: "Kikao chako kimekwisha. Tafadhali ingia tena.",
  },
  SESSION_CLOSED: {
    en: "This session has been closed.",
    sw: "Kikao hiki kimefungwa.",
  },
  INVALID_CREDENTIALS: {
    en: "The email or password is incorrect.",
    sw: "Barua pepe au nenosiri si sahihi.",
  },
  INVALID_TOKEN: {
    en: "This link or token is invalid. Please request a new one.",
    sw: "Kiungo au tokeni hii si sahihi. Tafadhali omba nyingine mpya.",
  },
  INVALID_CODE: {
    en: "The code you entered is incorrect.",
    sw: "Msimbo uliouingiza si sahihi.",
  },
  BAD_CODE: {
    en: "The code you entered is incorrect.",
    sw: "Msimbo uliouingiza si sahihi.",
  },
  EXPIRED: {
    en: "This has expired. Please request a new one.",
    sw: "Hii imeisha muda. Tafadhali omba nyingine mpya.",
  },
  TOKEN_CIPHER_NOT_PROVISIONED: {
    en: "Sign-in is temporarily unavailable. Please try again shortly.",
    sw: "Kuingia hakuwezekani kwa sasa. Tafadhali jaribu tena baada ya muda mfupi.",
  },
  TOO_MANY_ATTEMPTS: {
    en: "Too many attempts. Please wait a moment and try again.",
    sw: "Umejaribu mara nyingi mno. Tafadhali subiri kidogo kisha ujaribu tena.",
  },
  ACCOUNT_DISABLED: {
    en: "This account has been disabled. Please contact support.",
    sw: "Akaunti hii imezimwa. Tafadhali wasiliana na usaidizi.",
  },
  ACCOUNT_NOT_ACTIVE: {
    en: "This account is not active yet.",
    sw: "Akaunti hii bado haijaanzishwa.",
  },
  BIOMETRIC_REQUIRED: {
    en: "Biometric verification is required to continue.",
    sw: "Uthibitishaji wa kibayometriki unahitajika ili kuendelea.",
  },
  STATE_ALREADY_USED: {
    en: "This sign-in link has already been used. Please start again.",
    sw: "Kiungo hiki cha kuingia kimeshatumika. Tafadhali anza upya.",
  },
  MISSING_CODE_OR_STATE: {
    en: "This sign-in link is incomplete. Please start again.",
    sw: "Kiungo hiki cha kuingia hakijakamilika. Tafadhali anza upya.",
  },
  OAUTH_CONSENT_DENIED: {
    en: "Sign-in was cancelled. Please try again to continue.",
    sw: "Kuingia kumeghairiwa. Tafadhali jaribu tena ili kuendelea.",
  },

  // ── Authorization / permission / tier / scope ──────────────────────────
  FORBIDDEN: {
    en: "You do not have permission to do this.",
    sw: "Huna ruhusa ya kufanya hili.",
  },
  UNAUTHORIZED: {
    en: "You do not have permission to do this.",
    sw: "Huna ruhusa ya kufanya hili.",
  },
  REFUSED: {
    en: "This request was refused.",
    sw: "Ombi hili limekataliwa.",
  },
  FORBIDDEN_PERSON: {
    en: "You do not have permission to access this person's records.",
    sw: "Huna ruhusa ya kufikia kumbukumbu za mtu huyu.",
  },
  FORBIDDEN_ROLE_MODE: {
    en: "Your role does not allow this action.",
    sw: "Wadhifa wako hauruhusu kitendo hiki.",
  },
  FORBIDDEN_TIER: {
    en: "Your plan does not include this feature.",
    sw: "Mpango wako haujumuishi kipengele hiki.",
  },
  TIER_POLICY_DENIED: {
    en: "Your plan does not include this feature.",
    sw: "Mpango wako haujumuishi kipengele hiki.",
  },
  UNSUPPORTED_ROLE: {
    en: "Your role does not allow this action.",
    sw: "Wadhifa wako hauruhusu kitendo hiki.",
  },
  PRIVACY_DENIED: {
    en: "You do not have permission to view this information.",
    sw: "Huna ruhusa ya kuona taarifa hii.",
  },
  PLATFORM_SCOPE_FORBIDDEN: {
    en: "You do not have permission to do this.",
    sw: "Huna ruhusa ya kufanya hili.",
  },
  SOVEREIGN_FLAG_FORBIDDEN: {
    en: "You do not have permission to do this.",
    sw: "Huna ruhusa ya kufanya hili.",
  },
  INVALID_SCOPE: {
    en: "You do not have permission for this scope.",
    sw: "Huna ruhusa kwa eneo hili.",
  },
  NO_KILLSWITCH_AUTHORITY: {
    en: "You do not have permission to do this.",
    sw: "Huna ruhusa ya kufanya hili.",
  },
  LIVEBLOCKS_ROOM_FORBIDDEN: {
    en: "You do not have permission to join this room.",
    sw: "Huna ruhusa ya kujiunga na chumba hiki.",
  },
  FEATURE_DISABLED: {
    en: "This feature is currently turned off.",
    sw: "Kipengele hiki kimezimwa kwa sasa.",
  },
  VISION_CAPABILITY_DISABLED: {
    en: "Image understanding is turned off for your account.",
    sw: "Uchambuzi wa picha umezimwa kwa akaunti yako.",
  },
  KILL_SWITCH_ACTIVE: {
    en: "This action is paused for safety. Please try again later.",
    sw: "Kitendo hiki kimesimamishwa kwa usalama. Tafadhali jaribu tena baadaye.",
  },
  CONSENT_REQUIRED: {
    en: "Your consent is required to continue.",
    sw: "Idhini yako inahitajika ili kuendelea.",
  },

  // ── Tenant / organisation context ──────────────────────────────────────
  MISSING_TENANT: {
    en: "No organisation is selected. Please choose an organisation.",
    sw: "Hakuna shirika lililochaguliwa. Tafadhali chagua shirika.",
  },
  NO_TENANT: {
    en: "No organisation is selected. Please choose an organisation.",
    sw: "Hakuna shirika lililochaguliwa. Tafadhali chagua shirika.",
  },
  TENANT_REQUIRED: {
    en: "No organisation is selected. Please choose an organisation.",
    sw: "Hakuna shirika lililochaguliwa. Tafadhali chagua shirika.",
  },
  TENANT_CONTEXT_MISSING: {
    en: "No organisation is selected. Please choose an organisation.",
    sw: "Hakuna shirika lililochaguliwa. Tafadhali chagua shirika.",
  },
  MISSING_TENANT_OR_USER: {
    en: "No organisation is selected. Please choose an organisation.",
    sw: "Hakuna shirika lililochaguliwa. Tafadhali chagua shirika.",
  },
  TENANT_NOT_ACTIVE: {
    en: "This organisation is not active.",
    sw: "Shirika hili halijaanzishwa.",
  },
  TENANT_NOT_LINKED: {
    en: "Your account is not linked to this organisation.",
    sw: "Akaunti yako haijaunganishwa na shirika hili.",
  },
  TENANT_SCOPE_MISMATCH: {
    en: "This item belongs to a different organisation.",
    sw: "Kipengele hiki ni cha shirika lingine.",
  },
  CROSS_TENANT_WORKER: {
    en: "This worker belongs to a different organisation.",
    sw: "Mfanyakazi huyu ni wa shirika lingine.",
  },
  CROSS_TENANT_EQUIPMENT: {
    en: "This equipment belongs to a different organisation.",
    sw: "Kifaa hiki ni cha shirika lingine.",
  },
  BREAK_GLASS_TENANT_MISMATCH: {
    en: "This item belongs to a different organisation.",
    sw: "Kipengele hiki ni cha shirika lingine.",
  },
  INVALID_STATE_TENANT: {
    en: "This item belongs to a different organisation.",
    sw: "Kipengele hiki ni cha shirika lingine.",
  },
  INVALID_SELLER_TENANT: {
    en: "This seller belongs to a different organisation.",
    sw: "Muuzaji huyu ni wa shirika lingine.",
  },

  // ── Validation / bad input ─────────────────────────────────────────────
  VALIDATION: {
    en: "Please check the details you entered and try again.",
    sw: "Tafadhali kagua maelezo uliyoyaingiza kisha ujaribu tena.",
  },
  INVALID: {
    en: "Please check the details you entered and try again.",
    sw: "Tafadhali kagua maelezo uliyoyaingiza kisha ujaribu tena.",
  },
  INVALID_INPUT: {
    en: "Please check the details you entered and try again.",
    sw: "Tafadhali kagua maelezo uliyoyaingiza kisha ujaribu tena.",
  },
  BAD_INPUT: {
    en: "Please check the details you entered and try again.",
    sw: "Tafadhali kagua maelezo uliyoyaingiza kisha ujaribu tena.",
  },
  BAD_REQUEST: {
    en: "Please check the details you entered and try again.",
    sw: "Tafadhali kagua maelezo uliyoyaingiza kisha ujaribu tena.",
  },
  INVALID_BODY: {
    en: "Please check the details you entered and try again.",
    sw: "Tafadhali kagua maelezo uliyoyaingiza kisha ujaribu tena.",
  },
  INVALID_PARAM: {
    en: "Please check the details you entered and try again.",
    sw: "Tafadhali kagua maelezo uliyoyaingiza kisha ujaribu tena.",
  },
  INVALID_PARAMS: {
    en: "Please check the details you entered and try again.",
    sw: "Tafadhali kagua maelezo uliyoyaingiza kisha ujaribu tena.",
  },
  INVALID_QUERY: {
    en: "Please check the details you entered and try again.",
    sw: "Tafadhali kagua maelezo uliyoyaingiza kisha ujaribu tena.",
  },
  TOOL_INPUT_INVALID: {
    en: "Please check the details you entered and try again.",
    sw: "Tafadhali kagua maelezo uliyoyaingiza kisha ujaribu tena.",
  },
  INVALID_STEP_PAYLOAD: {
    en: "Please check the details you entered and try again.",
    sw: "Tafadhali kagua maelezo uliyoyaingiza kisha ujaribu tena.",
  },
  BAD_JSON: {
    en: "The request could not be read. Please try again.",
    sw: "Ombi halikuweza kusomeka. Tafadhali jaribu tena.",
  },
  INVALID_JSON: {
    en: "The request could not be read. Please try again.",
    sw: "Ombi halikuweza kusomeka. Tafadhali jaribu tena.",
  },
  INVALID_MULTIPART: {
    en: "The upload could not be read. Please try again.",
    sw: "Pakizo halikuweza kusomeka. Tafadhali jaribu tena.",
  },
  EMPTY_CONTENT: {
    en: "Please add some content before continuing.",
    sw: "Tafadhali ongeza maudhui kabla ya kuendelea.",
  },
  EMPTY_PATCH: {
    en: "There are no changes to save.",
    sw: "Hakuna mabadiliko ya kuhifadhi.",
  },
  EMPTY_RUN: {
    en: "There is nothing to run.",
    sw: "Hakuna kitu cha kuendesha.",
  },
  NO_PAGES: {
    en: "This document has no pages.",
    sw: "Hati hii haina kurasa.",
  },
  INVALID_PERIOD: {
    en: "Please choose a valid period.",
    sw: "Tafadhali chagua kipindi sahihi.",
  },
  INVALID_DEPTH: {
    en: "Please choose a valid depth.",
    sw: "Tafadhali chagua kina sahihi.",
  },
  INVALID_INDEX: {
    en: "That item could not be found in the list.",
    sw: "Kipengele hicho hakikupatikana kwenye orodha.",
  },
  ACTION_INDEX_OUT_OF_RANGE: {
    en: "That action is no longer available.",
    sw: "Kitendo hicho hakipatikani tena.",
  },
  SHARE_OVERFLOW: {
    en: "The shares entered exceed what is available.",
    sw: "Hisa ulizoingiza zinazidi zinazopatikana.",
  },
  INVALID_TONNAGE_RANGE: {
    en: "Please enter a valid tonnage range.",
    sw: "Tafadhali ingiza kipimo sahihi cha tani.",
  },
  DELIVERY_IN_PAST: {
    en: "The delivery date cannot be in the past.",
    sw: "Tarehe ya uwasilishaji haiwezi kuwa imepita.",
  },
  TRIGGER_IN_PAST: {
    en: "The scheduled time cannot be in the past.",
    sw: "Muda uliopangwa hauwezi kuwa umepita.",
  },
  WINDOW_LAPSED: {
    en: "The time window for this has passed.",
    sw: "Muda wa kufanya hili umepita.",
  },
  INVALID_AGREEMENT_ID: {
    en: "This agreement could not be found.",
    sw: "Mkataba huu haukupatikana.",
  },
  INVALID_BID_ID: {
    en: "This bid could not be found.",
    sw: "Zabuni hii haikupatikana.",
  },
  INVALID_SETTLEMENT_ID: {
    en: "This settlement could not be found.",
    sw: "Malipo haya hayakupatikana.",
  },
  INVALID_NOTIFICATION_ID: {
    en: "This notification could not be found.",
    sw: "Arifa hii haikupatikana.",
  },
  INVALID_PING_ID: {
    en: "This item could not be found.",
    sw: "Kipengele hiki hakikupatikana.",
  },
  INVALID_RESPONSE_ID: {
    en: "This response could not be found.",
    sw: "Jibu hili halikupatikana.",
  },
  BAD_REVISION_NO: {
    en: "This document was updated by someone else. Please reload and try again.",
    sw: "Hati hii ilibadilishwa na mtu mwingine. Tafadhali pakia upya kisha ujaribu tena.",
  },
  CORRUPT_TARGET: {
    en: "This item is damaged and cannot be opened.",
    sw: "Kipengele hiki kimeharibika na hakiwezi kufunguliwa.",
  },

  // ── File / upload / media ──────────────────────────────────────────────
  FILE_REQUIRED: {
    en: "Please attach a file to continue.",
    sw: "Tafadhali ambatisha faili ili kuendelea.",
  },
  FILE_TOO_LARGE: {
    en: "This file is too large. Please choose a smaller one.",
    sw: "Faili hili ni kubwa mno. Tafadhali chagua dogo zaidi.",
  },
  IMAGE_TOO_LARGE: {
    en: "This image is too large. Please choose a smaller one.",
    sw: "Picha hii ni kubwa mno. Tafadhali chagua ndogo zaidi.",
  },
  UNSUPPORTED_FILE_TYPE: {
    en: "This file type is not supported.",
    sw: "Aina hii ya faili hairuhusiwi.",
  },
  MIME_NOT_ALLOWED: {
    en: "This file type is not supported.",
    sw: "Aina hii ya faili hairuhusiwi.",
  },
  MIME_NOT_IMAGE: {
    en: "Please upload an image file.",
    sw: "Tafadhali pakia faili la picha.",
  },
  INVALID_AUDIO: {
    en: "This audio could not be read. Please try again.",
    sw: "Sauti hii haikuweza kusomeka. Tafadhali jaribu tena.",
  },

  // ── Not found (resources) ──────────────────────────────────────────────
  NOT_FOUND: {
    en: "This item could not be found.",
    sw: "Kipengele hiki hakikupatikana.",
  },
  ENTITY_NOT_FOUND: {
    en: "This item could not be found.",
    sw: "Kipengele hiki hakikupatikana.",
  },
  NODE_NOT_FOUND: {
    en: "This item could not be found.",
    sw: "Kipengele hiki hakikupatikana.",
  },
  ASSET_NOT_FOUND: {
    en: "This asset could not be found.",
    sw: "Rasilimali hii haikupatikana.",
  },
  AGENT_NOT_FOUND: {
    en: "This agent could not be found.",
    sw: "Wakala huyu hakupatikana.",
  },
  DOCUMENTS_NOT_FOUND: {
    en: "These documents could not be found.",
    sw: "Hati hizi hazikupatikana.",
  },
  EXTRACTION_NOT_FOUND: {
    en: "This extraction could not be found.",
    sw: "Uchambuzi huu haukupatikana.",
  },
  FILING_NOT_FOUND: {
    en: "This filing could not be found.",
    sw: "Wasilisho hili halikupatikana.",
  },
  FORECAST_NOT_FOUND: {
    en: "This forecast could not be found.",
    sw: "Utabiri huu haukupatikana.",
  },
  ACTION_PLAN_NOT_FOUND: {
    en: "This action plan could not be found.",
    sw: "Mpango huu wa hatua haukupatikana.",
  },
  CANDIDATE_NOT_FOUND: {
    en: "This candidate could not be found.",
    sw: "Mgombea huyu hakupatikana.",
  },
  COMMITMENT_NOT_FOUND: {
    en: "This commitment could not be found.",
    sw: "Ahadi hii haikupatikana.",
  },
  ENGAGEMENT_NOT_FOUND: {
    en: "This engagement could not be found.",
    sw: "Ushirikiano huu haukupatikana.",
  },
  GROUP_NOT_FOUND: {
    en: "This group could not be found.",
    sw: "Kundi hili halikupatikana.",
  },
  LEAD_NOT_FOUND: {
    en: "This lead could not be found.",
    sw: "Kinara hiki hakikupatikana.",
  },
  LEAVE_NOT_FOUND: {
    en: "This leave request could not be found.",
    sw: "Ombi hili la likizo halikupatikana.",
  },
  LETTER_NOT_FOUND: {
    en: "This letter could not be found.",
    sw: "Barua hii haikupatikana.",
  },
  LISTING_NOT_FOUND: {
    en: "This listing could not be found.",
    sw: "Tangazo hili halikupatikana.",
  },
  OPENING_NOT_FOUND: {
    en: "This opening could not be found.",
    sw: "Nafasi hii haikupatikana.",
  },
  PARTY_NOT_FOUND: {
    en: "This party could not be found.",
    sw: "Mhusika huyu hakupatikana.",
  },
  PERSONA_NOT_FOUND: {
    en: "This persona could not be found.",
    sw: "Mhusika huyu hakupatikana.",
  },
  RECIPIENT_NOT_FOUND: {
    en: "This recipient could not be found.",
    sw: "Mpokeaji huyu hakupatikana.",
  },
  RESPONSE_NOT_FOUND: {
    en: "This response could not be found.",
    sw: "Jibu hili halikupatikana.",
  },
  RFB_NOT_FOUND: {
    en: "This request for bids could not be found.",
    sw: "Ombi hili la zabuni halikupatikana.",
  },
  RUN_NOT_FOUND: {
    en: "This run could not be found.",
    sw: "Mzunguko huu haukupatikana.",
  },
  SETTLEMENT_NOT_FOUND: {
    en: "This settlement could not be found.",
    sw: "Malipo haya hayakupatikana.",
  },
  TAB_NOT_FOUND: {
    en: "This tab could not be found.",
    sw: "Kichupo hiki hakikupatikana.",
  },
  THREAD_NOT_FOUND: {
    en: "This conversation could not be found.",
    sw: "Mazungumzo haya hayakupatikana.",
  },
  INTELLIGENCE_THREAD_NOT_FOUND: {
    en: "This conversation could not be found.",
    sw: "Mazungumzo haya hayakupatikana.",
  },
  DEVICE_TOKEN_NOT_FOUND: {
    en: "This device could not be found.",
    sw: "Kifaa hiki hakikupatikana.",
  },
  OWNER_TABS_NOT_FOUND: {
    en: "This layout could not be found.",
    sw: "Mpangilio huu haukupatikana.",
  },

  // ── Conflict / state / already-done ────────────────────────────────────
  CONFLICT: {
    en: "This was already changed. Please reload and try again.",
    sw: "Hili lilishabadilishwa. Tafadhali pakia upya kisha ujaribu tena.",
  },
  IDEMPOTENCY_CONFLICT: {
    en: "This request was already received.",
    sw: "Ombi hili lilishapokelewa.",
  },
  ALREADY_ACTIVE: {
    en: "This is already active.",
    sw: "Hili lishaanzishwa tayari.",
  },
  ALREADY_APPLIED: {
    en: "This has already been applied.",
    sw: "Hili limeshatumika tayari.",
  },
  ALREADY_CLOSED: {
    en: "This is already closed.",
    sw: "Hili limeshafungwa tayari.",
  },
  ALREADY_LOCKED: {
    en: "This is already locked.",
    sw: "Hili limeshafungwa tayari.",
  },
  ALREADY_PASSED: {
    en: "This has already passed.",
    sw: "Hili limeshapita tayari.",
  },
  ALREADY_REVOKED: {
    en: "This has already been revoked.",
    sw: "Hili limeshabatilishwa tayari.",
  },
  ALREADY_SUBMITTED: {
    en: "This has already been submitted.",
    sw: "Hili limeshawasilishwa tayari.",
  },
  ALREADY_UNDONE: {
    en: "This has already been undone.",
    sw: "Hili limeshatenduliwa tayari.",
  },
  NOT_UNDONE: {
    en: "This has not been undone.",
    sw: "Hili halijatenduliwa.",
  },
  IMMUTABLE_STATUS: {
    en: "This can no longer be changed.",
    sw: "Hili haliwezi kubadilishwa tena.",
  },
  INVALID_STATE: {
    en: "This cannot be done in its current state.",
    sw: "Hili haliwezi kufanyika katika hali yake ya sasa.",
  },
  NOT_READY: {
    en: "This is not ready yet. Please try again shortly.",
    sw: "Hili bado halijawa tayari. Tafadhali jaribu tena baada ya muda mfupi.",
  },
  NOT_ACKNOWLEDGEABLE: {
    en: "This cannot be acknowledged.",
    sw: "Hili haliwezi kuthibitishwa.",
  },
  SIGN_REJECTED: {
    en: "The signature was rejected.",
    sw: "Sahihi imekataliwa.",
  },
  OWNER_TABS_CONFLICT: {
    en: "This layout was changed elsewhere. Please reload and try again.",
    sw: "Mpangilio huu ulibadilishwa mahali pengine. Tafadhali pakia upya kisha ujaribu tena.",
  },
  OWNER_TABS_PINNED: {
    en: "This layout is pinned and cannot be changed.",
    sw: "Mpangilio huu umebandikwa na hauwezi kubadilishwa.",
  },
  OWNER_TABS_STATE_TOO_LARGE: {
    en: "This layout is too large to save.",
    sw: "Mpangilio huu ni mkubwa mno kuhifadhiwa.",
  },
  TAB_KEY_CONFLICT: {
    en: "A tab with this name already exists.",
    sw: "Kichupo chenye jina hili kishakuwepo.",
  },
  INVALID_TAB: {
    en: "This tab is not valid.",
    sw: "Kichupo hiki si sahihi.",
  },
  INVALID_TAB_SET: {
    en: "This tab set is not valid.",
    sw: "Mkusanyiko huu wa vichupo si sahihi.",
  },

  // ── Invitations / KYC / onboarding ─────────────────────────────────────
  INVITATION_NOT_FOUND: {
    en: "This invitation could not be found.",
    sw: "Mwaliko huu haukupatikana.",
  },
  INVITATION_EXPIRED: {
    en: "This invitation has expired. Please request a new one.",
    sw: "Mwaliko huu umeisha muda. Tafadhali omba mwingine mpya.",
  },
  INVITATION_NOT_PENDING: {
    en: "This invitation is no longer pending.",
    sw: "Mwaliko huu hausubiri tena.",
  },
  PENDING_NOT_FOUND_OR_EXPIRED: {
    en: "This request could not be found or has expired.",
    sw: "Ombi hili halikupatikana au limeisha muda.",
  },
  KYC_ALREADY_SUBMITTED: {
    en: "Your verification details have already been submitted.",
    sw: "Taarifa zako za uthibitishaji zimeshawasilishwa.",
  },
  NO_KYC_ON_FILE: {
    en: "No verification details are on file. Please complete verification first.",
    sw: "Hakuna taarifa za uthibitishaji zilizohifadhiwa. Tafadhali kamilisha uthibitishaji kwanza.",
  },

  // ── Marketplace / bids / settlement (buyer/seller) ─────────────────────
  BID_TERMINAL: {
    en: "This bid is closed and can no longer be changed.",
    sw: "Zabuni hii imefungwa na haiwezi kubadilishwa tena.",
  },
  NOT_BID_OWNER: {
    en: "You can only manage your own bids.",
    sw: "Unaweza kusimamia zabuni zako pekee.",
  },
  UNAUTHORIZED_BUYER: {
    en: "You do not have permission to do this.",
    sw: "Huna ruhusa ya kufanya hili.",
  },
  NOT_SETTLEMENT_BUYER: {
    en: "Only the buyer can do this for this settlement.",
    sw: "Mnunuzi pekee ndiye anaweza kufanya hili kwa malipo haya.",
  },
  SETTLEMENT_NOT_SETTLED: {
    en: "This settlement has not been completed yet.",
    sw: "Malipo haya bado hayajakamilika.",
  },
  RFB_NOT_OPEN: {
    en: "This request for bids is not open.",
    sw: "Ombi hili la zabuni halijafunguliwa.",
  },
  RFB_NOT_FOUND_OR_NOT_OPEN: {
    en: "This request for bids could not be found or is not open.",
    sw: "Ombi hili la zabuni halikupatikana au halijafunguliwa.",
  },
  QUOTE_EXPIRED: {
    en: "This quote has expired. Please request a new one.",
    sw: "Nukuu hii imeisha muda. Tafadhali omba nyingine mpya.",
  },
  PARCEL_ALREADY_SOLD: {
    en: "This parcel has already been sold.",
    sw: "Kifurushi hiki kimeshauzwa.",
  },
  UNKNOWN_COMMODITY: {
    en: "This commodity is not recognised.",
    sw: "Bidhaa hii haitambuliki.",
  },
  OUTSIDE_FENCE: {
    en: "This location is outside the allowed area.",
    sw: "Eneo hili liko nje ya eneo linaloruhusiwa.",
  },

  // ── Approvals / four-eye / governance ──────────────────────────────────
  FOUR_EYE_REQUIRED: {
    en: "A second approver is required for this action.",
    sw: "Mhakiki wa pili anahitajika kwa kitendo hiki.",
  },
  FOUR_EYE_NOT_REQUIRED: {
    en: "A second approver is not required for this action.",
    sw: "Mhakiki wa pili hahitajiki kwa kitendo hiki.",
  },
  FOUR_EYE_SAME_ACTOR: {
    en: "The second approver must be a different person.",
    sw: "Mhakiki wa pili lazima awe mtu tofauti.",
  },
  RUN_NOT_AWAITING_APPROVAL: {
    en: "This is not awaiting approval.",
    sw: "Hili halisubiri idhini.",
  },
  NON_REGULATORY: {
    en: "This action is not available for non-regulatory items.",
    sw: "Kitendo hiki hakipatikani kwa vipengele visivyo vya udhibiti.",
  },
  UNRESOLVABLE_COVERAGE: {
    en: "Coverage for this could not be determined.",
    sw: "Ufunikaji wa hili haukuweza kubainishwa.",
  },
  INSUFFICIENT_HISTORY: {
    en: "There is not enough history to do this yet.",
    sw: "Hakuna historia ya kutosha kufanya hili kwa sasa.",
  },

  // ── Rate limits / budget ───────────────────────────────────────────────
  RATE_LIMIT: {
    en: "Too many requests. Please slow down and try again shortly.",
    sw: "Maombi mengi mno. Tafadhali punguza kasi kisha ujaribu tena baada ya muda mfupi.",
  },
  RATE_LIMITED: {
    en: "Too many requests. Please slow down and try again shortly.",
    sw: "Maombi mengi mno. Tafadhali punguza kasi kisha ujaribu tena baada ya muda mfupi.",
  },
  RATE_LIMIT_EXCEEDED: {
    en: "Too many requests. Please slow down and try again shortly.",
    sw: "Maombi mengi mno. Tafadhali punguza kasi kisha ujaribu tena baada ya muda mfupi.",
  },
  PUBLIC_TOOL_RATE_LIMIT_EXCEEDED: {
    en: "Too many requests. Please slow down and try again shortly.",
    sw: "Maombi mengi mno. Tafadhali punguza kasi kisha ujaribu tena baada ya muda mfupi.",
  },
  SENSORIUM_RATE_LIMITED: {
    en: "Too many requests. Please slow down and try again shortly.",
    sw: "Maombi mengi mno. Tafadhali punguza kasi kisha ujaribu tena baada ya muda mfupi.",
  },
  BUDGET_EXCEEDED: {
    en: "Your usage limit has been reached. Please try again later.",
    sw: "Kikomo chako cha matumizi kimefikiwa. Tafadhali jaribu tena baadaye.",
  },
  BUDGET_EXCEEDED_MID_TURN: {
    en: "Your usage limit has been reached. Please try again later.",
    sw: "Kikomo chako cha matumizi kimefikiwa. Tafadhali jaribu tena baadaye.",
  },

  // ── AI / chat guardrails (user-facing) ─────────────────────────────────
  INPUT_GUARD_REFUSED: {
    en: "This request can't be processed. Please rephrase and try again.",
    sw: "Ombi hili haliwezi kushughulikiwa. Tafadhali liandike upya kisha ujaribu tena.",
  },
  KERNEL_REFUSED: {
    en: "This request can't be processed. Please rephrase and try again.",
    sw: "Ombi hili haliwezi kushughulikiwa. Tafadhali liandike upya kisha ujaribu tena.",
  },
  UNKNOWN_ACTION: {
    en: "This action is not recognised.",
    sw: "Kitendo hiki hakitambuliki.",
  },
  UNKNOWN_DOMAIN: {
    en: "This area is not recognised.",
    sw: "Eneo hili halitambuliki.",
  },
  UNKNOWN_TEMPLATE: {
    en: "This template is not recognised.",
    sw: "Kiolezo hiki hakitambuliki.",
  },
  UNKNOWN_CONNECTOR: {
    en: "This connection is not recognised.",
    sw: "Muunganisho huu hautambuliki.",
  },
  UNKNOWN_CONTROL: {
    en: "This control is not recognised.",
    sw: "Kidhibiti hiki hakitambuliki.",
  },
  UNKNOWN_BINDING: {
    en: "This binding is not recognised.",
    sw: "Kifungo hiki hakitambuliki.",
  },
  UNSUPPORTED_ENTITY: {
    en: "This item type is not supported.",
    sw: "Aina hii ya kipengele hairuhusiwi.",
  },
  UNSUPPORTED_PROVIDER: {
    en: "This provider is not supported.",
    sw: "Mtoa-huduma huyu haruhusiwi.",
  },
  BAD_CONNECTOR_ID: {
    en: "This connection is not recognised.",
    sw: "Muunganisho huu hautambuliki.",
  },
  CHANNEL_UNSUPPORTED: {
    en: "This channel is not supported.",
    sw: "Njia hii hairuhusiwi.",
  },
  TOOL_NOT_IN_SAFELIST: {
    en: "This tool is not available.",
    sw: "Zana hii haipatikani.",
  },

  // ── Cooperatives / chain-of-custody ────────────────────────────────────
  COC_CHAIN_EMPTY: {
    en: "There is no chain-of-custody record for this yet.",
    sw: "Hakuna kumbukumbu ya mnyororo wa uangalizi kwa hili bado.",
  },
  COC_PARCEL_NOT_LINKED: {
    en: "This parcel is not linked to a chain-of-custody record.",
    sw: "Kifurushi hiki hakijaunganishwa na kumbukumbu ya mnyororo wa uangalizi.",
  },
  NOT_THREAD_PARTICIPANT: {
    en: "You are not part of this conversation.",
    sw: "Wewe si sehemu ya mazungumzo haya.",
  },

  // ── Misc domain ────────────────────────────────────────────────────────
  REVOKED: {
    en: "This has been revoked.",
    sw: "Hili limebatilishwa.",
  },
  DEGRADED: {
    en: "Some information may be incomplete right now. Please try again shortly.",
    sw: "Baadhi ya taarifa zinaweza zisiwe kamili kwa sasa. Tafadhali jaribu tena baada ya muda mfupi.",
  },
};
