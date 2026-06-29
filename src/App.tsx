import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  BarChart3,
  BookOpen,
  Building2,
  Bus,
  Camera,
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  Clock3,
  Droplets,
  EyeOff,
  FileText,
  HeartPulse,
  Home,
  Languages,
  Landmark,
  Lightbulb,
  Link as LinkIcon,
  LocateFixed,
  LockKeyhole,
  MapPin,
  Megaphone,
  Phone,
  RadioTower,
  Receipt,
  RotateCcw,
  Send,
  ShieldAlert,
  ShieldCheck,
  Upload,
  Wrench,
  Zap,
} from "lucide-react";
import {
  createTicketInSpine,
  fetchCitizenConfig,
  fetchCitizenTicketsFromSpine,
  fetchTicketFromSpine,
  fetchTicketNotificationsFromSpine,
  startMockOtpChallenge,
  submitCitizenDisputeInSpine,
  submitCitizenUpdateInSpine,
  uploadCitizenEvidenceToSpine,
  verifyMockOtpChallenge,
  type CitizenEvidenceUploadPayload,
  type CitizenCategoryAvailability,
  type PublicAssetPolicy,
  type TicketSpineNotification,
  type TicketSpineTicket,
} from "./mvpTicketApi";
import { newClientNonce } from "./idempotency";
import type { WhistleAuthSession } from "./authApi";

type Language = "en" | "ta";
type Screen =
  | "home"
  | "category"
  | "department"
  | "details"
  | "location"
  | "otp"
  | "review"
  | "confirmation"
  | "tickets"
  | "ticketDetail"
  | "addInfo"
  | "reopenDispute"
  | "insights";
type CategoryId =
  | "corruption"
  | "roads"
  | "water"
  | "power"
  | "sanitation"
  | "safety"
  | "health"
  | "education"
  | "revenue"
  | "ration"
  | "other";
type TicketState = "awaiting" | "verification" | "local" | "ministry" | "cmCell" | "rejectedReview" | "resolved";
type SlaState = "onTrack" | "dueSoon" | "breached" | "awaiting" | "resolved";

type Category = {
  id: CategoryId;
  icon: typeof Wrench;
  label: Record<Language, string>;
  group: "protected" | "civic" | "social";
  description: Record<Language, string>;
};

type Department = {
  icon: typeof Building2;
  name: Record<Language, string>;
  desc: Record<Language, string>;
};

type TimelineEvent = {
  icon: typeof CheckCircle2;
  label: string;
  time: string;
  note?: string;
  tone?: "good" | "warn" | "danger" | "neutral";
};

type Ticket = {
  id: string;
  title: string;
  category: CategoryId;
  state: TicketState;
  slaState: SlaState;
  stageLabel: string;
  stageChip: string;
  created: string;
  location: string;
  primaryQueue: string;
  secondaryQueues: string[];
  slaLabel: string;
  slaRemaining: string;
  slaProgress: number;
  age: string;
  escalations: number;
  protectedIdentity: boolean;
  description: string;
  department?: string;
  evidenceCount?: number;
  reference?: string;
  notificationHistory: string[];
  timeline: TimelineEvent[];
  actionRequest?: {
    title: string;
    body: string;
    missing: string[];
  };
  rejection?: {
    reason: string;
    review: string;
  };
  spineBacked?: boolean;
  spineSyncedAt?: string;
  spineSyncState?: "synced" | "offline" | "notFound";
  citizenPhone?: string;
  citizenAccessToken?: string;
};

type AddInfoPayload = {
  address: string;
  details: string;
  evidenceCount: number;
};

declare global {
  interface Window {
    __WHISTLE_CITIZEN_ASSET_POLICY__?: PublicAssetPolicy;
  }
}

const neutralAssetPolicy: PublicAssetPolicy = {
  logo: { approved: true, src: "/assets/brand/whistle-fake-logo.svg", label: "Whistle logo", fallbackLabel: "Whistle" },
  emblem: { approved: true, src: "/assets/brand/whistle-civic-mark.svg", label: "Neutral civic service mark", fallbackLabel: "Civic" },
  portrait: { approved: true, src: "/assets/brand/whistle-service-portrait.svg", label: "Neutral citizen-service illustration", fallbackLabel: "Service" },
  disclaimer: {
    approved: true,
    text: "Whistle is running in local UAT mode with neutral approved app identity. Official marks can be enabled after public-use approval.",
  },
};

const initialAssetPolicy = typeof window !== "undefined" ? window.__WHISTLE_CITIZEN_ASSET_POLICY__ ?? neutralAssetPolicy : neutralAssetPolicy;

type ReopenDisputePayload = {
  reason: string;
  evidenceCount: number;
};

type ComplaintForm = {
  title: string;
  description: string;
  reference: string;
  amount: string;
  officer: string;
  issueLocation: string;
  district: string;
  area: string;
  landmark: string;
  phone: string;
  evidence: CitizenEvidenceUploadPayload[];
  otp: string;
  gps: boolean;
};

type OtpState = {
  status: "idle" | "sending" | "sent" | "verifying" | "verified" | "error";
  challengeId?: string;
  phoneMasked?: string;
  mockOtp?: string;
  verificationToken?: string;
  message?: string;
};

type TicketListSyncState = {
  status: "idle" | "needsVerification" | "loading" | "liveLoaded" | "liveEmpty" | "offline" | "rejected";
  count?: number;
  message?: string;
  maskedPhone?: string;
};

type TicketDetailBrief = {
  tone: "action" | "watch" | "escalated" | "resolved";
  icon: typeof Clock3;
  ownerLabel: string;
  ownerNote: string;
  slaTitle: string;
  slaNote: string;
  escalationPath: string[];
  citizenActionTitle: string;
  citizenActionBody: string;
};

const t = {
  en: {
    home: "Home",
    raise: "Raise",
    tickets: "My Tickets",
    insights: "Insights",
    back: "Back",
    appName: "Whistle",
    appNameTa: "விசில்",
    appSub: "Tamil Nadu citizens' voice",
    heroSub: "Tamil Nadu Citizens' Voice",
    heroTitle: "Raise a complaint. Hold them accountable.",
    raiseComplaint: "Raise Complaint",
    identity: "Identity Protected",
    otp: "OTP Verified",
    sla: "SLA Tracked",
    accountable: "Govt Accountable",
    quickCategories: "Quick Raise by Category",
    liveApiConnected: "Connected — live complaint updates on",
    liveApiConnecting: "Connecting to the complaint service",
    liveApiOffline: "Service unreachable; saved data shown",
    categoryConfigOffline: "Live launch controls unavailable. Showing saved UAT availability.",
    openStatus: "Open",
    protectedPilotStatus: "Identity Protected",
    pilotOnlyStatus: "Opening Soon",
    blockedStatus: "Not Open",
    disabledStatus: "Disabled",
    categoryNotOpen: "This category is visible for rollout planning, but public complaints are not open yet.",
    openMessage: "Open for public complaint intake.",
    protectedPilotMessage: "Protected intake only. Local levels cannot see identity before screening.",
    pilotOnlyMessage: "Not open for public complaints yet.",
    blockedMessage: "Not launch-ready yet. Admin must complete owner, SLA, SOP, and training readiness.",
    disabledMessage: "Temporarily unavailable.",
    publicInsights: "Public Complaint Insights",
    myComplaints: "My Complaints",
    activeTickets: "3 active · 1 needs your response",
    chooseCategory: "Choose Category",
    categoryHelp: "Select the category that best describes your complaint. This helps route it to the right team and sets the appropriate SLA.",
    corruptionGroup: "Corruption & Misconduct",
    civicGroup: "Civic Services",
    socialGroup: "Social Services",
    protected: "Protected",
    selectDepartment: "Select Department",
    unsure: "Not sure? We'll help route it correctly during verification.",
    detailsTitle: "Complaint Details",
    titleLabel: "Complaint Title",
    titleMinHint: "Minimum 6 characters",
    titlePlaceholder: "Large pothole near Anna Nagar bus terminus",
    descLabel: "Description",
    descMinHint: "Minimum 20 characters",
    descPlaceholder: "Describe what happened, when it started, and what action is expected.",
    evidenceLabel: "Add Evidence",
    evidenceCta: "Tap to add photos or videos",
    evidenceHelp: "Helps get your complaint verified faster",
    referenceLabel: "Reference Number",
    referencePlaceholder: "Previous complaint ID, receipt, FIR, link, etc.",
    amountLabel: "Bribe/Misconduct Amount",
    officerLabel: "Name of Officer/Department",
    privacyNote: "Your phone number and personal details are never shown publicly. Government teams see only what is needed to resolve the complaint.",
    detailsRequiredHint: "Title and description are required before routing the complaint.",
    continueLocation: "Continue to Location",
    locationTitle: "Location",
    issueLocation: "Location of Issue",
    useGps: "Use GPS",
    manual: "Manual",
    manualLocationHint: "Street, ward, bus stop, or nearby point",
    locationDetected: "Location Detected",
    district: "District",
    selectDistrict: "Select district",
    area: "Area / Locality",
    landmark: "Landmark",
    landmarkPlaceholder: "Near school, bus stop, temple, etc.",
    locationPrivacy: "We use the location of the issue for routing, not your home address.",
    locationRequiredGps: "District and locality are needed for routing.",
    locationRequiredManual: "District, locality, and issue location are needed for routing.",
    continueVerification: "Continue to Verification",
    verifyPhone: "Verify Your Phone",
    enterOtp: "Enter OTP",
    otpBody: "Your number is used only for tracking updates. It is never shown publicly.",
    verifyReview: "Verify & Review",
    reviewSubmit: "Review & Submit",
    reviewHelp: "Please review your complaint before submitting. Once submitted, it enters the government verification queue.",
    reviewCategoryDepartment: "Category & Department",
    reviewCategoryLabel: "Category",
    reviewDepartmentLabel: "Department",
    reviewComplaintLabel: "Complaint",
    reviewTitleLabel: "Title",
    reviewDescriptionLabel: "Description",
    reviewEvidenceLabel: "Evidence",
    reviewLocationLabel: "Location",
    reviewAreaLabel: "Area",
    reviewDistrictLabel: "District",
    reviewLandmarkLabel: "Landmark",
    reviewNotProvided: "Not provided",
    reviewVerificationPrivacy: "Verification & Privacy",
    reviewPhoneLabel: "Phone",
    accountVerified: "Account verified",
    otpVerified: "OTP verified",
    reviewIdentityLabel: "Identity",
    reviewFirstSlaLabel: "First SLA",
    reviewVerificationSla: "Verification in 2 days",
    photoVideoItems: "photo/video item(s)",
    whatNextTitle: "What happens next?",
    whatNextBody: "Ticket Verification Team reviews within 2 days. SMS and in-app updates follow every stage.",
    submitComplaint: "Submit Complaint",
    submittingComplaint: "Submitting...",
    editDetails: "Edit Details",
    confirmationTitle: "You blew the Whistle!",
    complaintId: "Your Complaint ID",
    confirmationBody: "Your complaint has entered the Ticket Verification Queue. The team must verify within 2 days.",
    whatNext: "What to expect",
    expectDayOne: "Day 1-2",
    expectDayOneBody: "Verification and routing",
    expectDayTwo: "Day 3-9",
    expectDayTwoBody: "Local / MLA level SLA",
    expectDayThree: "Day 10+",
    expectDayThreeBody: "Auto-escalates to ministry if unresolved",
    trackStatus: "Track Status",
    done: "Done",
    filterAll: "All",
    actionNeeded: "Action Needed",
    verification: "Verification",
    escalated: "Escalated",
    resolved: "Resolved",
    ticketLookupTitle: "Load by phone",
    ticketLookupHelp: "Verify this phone to load your complaint records.",
    ticketLookupPhone: "Phone number",
    sendOtp: "Send OTP",
    verifyOtpShort: "Verify",
    verified: "Verified",
    syncTickets: "Get latest updates",
    syncTicketsLoading: "Syncing...",
    syncSavedTitle: "Saved app copy",
    syncSavedBody: "Verify your phone to load your latest complaint records.",
    syncVerifyTitle: "Verify first",
    syncVerifyBody: "OTP verification is required before live ticket lookup",
    syncCheckingTitle: "Checking for updates",
    syncCheckingBody: "Looking for complaints linked to this verified phone.",
    syncLiveTitle: "Live records loaded",
    syncEmptyTitle: "No live records",
    syncEmptyBody: "Saved app tickets remain visible below",
    syncOfflineTitle: "Service unreachable",
    syncBlockedTitle: "Sync blocked",
    cmCell: "CM Cell",
    queueResponsibility: "Queue Responsibility",
    complaintTimeline: "Complaint Timeline",
    notificationHistory: "Notification History",
    addMoreInfo: "Add More Info",
    resubmit: "Resubmit for Verification",
    reopenResolved: "Dispute / Reopen",
    disputeResolution: "Dispute Resolution",
    disputeHelp: "Use this if the issue was marked resolved but the ground reality is still not fixed.",
    disputeReason: "What is still unresolved?",
    disputeEvidence: "Add current proof",
    submitDispute: "Send for Review",
    aggregateOnly: "Aggregate data only. No personal information is ever shown here.",
  },
  ta: {
    home: "முகப்பு",
    raise: "புகார்",
    tickets: "என் புகார்கள்",
    insights: "நிலவரம்",
    back: "பின்",
    appName: "Whistle",
    appNameTa: "விசில்",
    appSub: "தமிழ்நாடு குடிமக்கள் குரல்",
    heroSub: "தமிழ்நாடு குடிமக்கள் குரல்",
    heroTitle: "புகார் அளியுங்கள். பொறுப்பைக் கண்காணியுங்கள்.",
    raiseComplaint: "புகார் பதிவு",
    identity: "அடையாள பாதுகாப்பு",
    otp: "OTP சரிபார்ப்பு",
    sla: "SLA கண்காணிப்பு",
    accountable: "அரசு பொறுப்பு",
    quickCategories: "வகைப்படி புகார்",
    liveApiConnected: "இணைப்பு செயலில் — புகார் நிலை நேரடியாகப் புதுப்பிக்கப்படும்",
    liveApiConnecting: "புகார் சேவையுடன் இணைக்கிறது",
    liveApiOffline: "சேவை கிடைக்கவில்லை; சேமித்த தரவு காட்டப்படுகிறது",
    categoryConfigOffline: "தற்போதைய சேமித்த சேவை நிலை காட்டப்படுகிறது.",
    openStatus: "திறந்தது",
    protectedPilotStatus: "அடையாளம் பாதுகாக்கப்படும்",
    pilotOnlyStatus: "விரைவில் திறக்கப்படும்",
    blockedStatus: "திறக்கவில்லை",
    disabledStatus: "நிறுத்தப்பட்டது",
    categoryNotOpen: "இந்த வகை rollout planningக்கு தெரியும்; public புகார் இன்னும் திறக்கப்படவில்லை.",
    openMessage: "பொது புகார்களுக்கு திறந்திருக்கும்.",
    protectedPilotMessage: "பாதுகாப்பான பதிவு மட்டும். பரிசோதனைக்கு முன் உள்ளூர் அலுவலர்களுக்கு அடையாளம் தெரியாது.",
    pilotOnlyMessage: "பொது புகார்களுக்கு இன்னும் திறக்கப்படவில்லை.",
    blockedMessage: "பொறுப்பு குழு, காலக்கெடு, நடைமுறை, பயிற்சி தயார் ஆன பிறகு திறக்கும்.",
    disabledMessage: "தற்காலிகமாக கிடைக்காது.",
    publicInsights: "பொது புகார் நிலவரம்",
    myComplaints: "என் புகார்கள்",
    activeTickets: "3 செயலில் · 1 பதில் தேவை",
    chooseCategory: "வகையை தேர்வு செய்யுங்கள்",
    categoryHelp: "உங்கள் புகாருக்கு பொருந்தும் வகையைத் தேர்வு செய்யுங்கள். இது சரியான குழுவிற்கு அனுப்ப உதவும்.",
    corruptionGroup: "ஊழல் & தவறான நடத்தை",
    civicGroup: "குடிமை சேவைகள்",
    socialGroup: "சமூக சேவைகள்",
    protected: "பாதுகாப்பு",
    selectDepartment: "துறையை தேர்வு செய்யுங்கள்",
    unsure: "தெரியவில்லையா? சரிபார்ப்பின் போது சரியான துறைக்கு அனுப்ப உதவுவோம்.",
    detailsTitle: "புகார் விவரம்",
    titleLabel: "புகார் தலைப்பு",
    titleMinHint: "குறைந்தது 6 எழுத்துகள்",
    titlePlaceholder: "எ.கா. தெருவில் குப்பை அகற்றப்படவில்லை",
    descLabel: "விவரம்",
    descMinHint: "குறைந்தது 20 எழுத்துகள்",
    descPlaceholder: "எப்போது தொடங்கியது, என்ன நடவடிக்கை வேண்டும் என்பதை எழுதுங்கள்.",
    evidenceLabel: "ஆதாரம் சேர்",
    evidenceCta: "புகைப்படம் அல்லது வீடியோ சேர்",
    evidenceHelp: "உங்கள் புகார் விரைவாக சரிபார்க்க உதவும்",
    referenceLabel: "குறிப்பு எண்",
    referencePlaceholder: "முந்தைய புகார் எண், ரசீது, FIR, இணைப்பு போன்றவை",
    amountLabel: "லஞ்சம்/தவறான தொகை",
    officerLabel: "அதிகாரி/துறை பெயர்",
    privacyNote: "உங்கள் தொலைபேசி எண் மற்றும் தனிப்பட்ட விவரங்கள் பொதுவாக காட்டப்படாது.",
    detailsRequiredHint: "புகாரை அனுப்ப தலைப்பு மற்றும் விவரம் தேவை.",
    continueLocation: "இடத்திற்கு தொடர்க",
    locationTitle: "இடம்",
    issueLocation: "பிரச்சினை இடம்",
    useGps: "GPS",
    manual: "கைமுறை",
    manualLocationHint: "தெரு, வார்டு, பேருந்து நிறுத்தம் அல்லது அருகிலுள்ள இடம்",
    locationDetected: "இடம் கண்டறியப்பட்டது",
    district: "மாவட்டம்",
    selectDistrict: "மாவட்டத்தை தேர்வு செய்யுங்கள்",
    area: "பகுதி",
    landmark: "அடையாள இடம்",
    landmarkPlaceholder: "பள்ளி, பேருந்து நிறுத்தம், கோவில் அருகில் போன்றவை",
    locationPrivacy: "அனுப்ப பிரச்சினை இடம் மட்டுமே பயன்படுத்தப்படும்; வீட்டு முகவரி அல்ல.",
    locationRequiredGps: "அனுப்ப மாவட்டம் மற்றும் பகுதி தேவை.",
    locationRequiredManual: "அனுப்ப மாவட்டம், பகுதி, பிரச்சினை இடம் தேவை.",
    continueVerification: "சரிபார்ப்பிற்கு தொடர்க",
    verifyPhone: "தொலைபேசி சரிபார்",
    enterOtp: "OTP உள்ளிடவும்",
    otpBody: "நிலை புதுப்பிப்புகளுக்கு மட்டுமே உங்கள் எண் பயன்படும். பொதுவாக காட்டப்படாது.",
    verifyReview: "சரிபார்த்து பாருங்கள்",
    reviewSubmit: "பார்த்து சமர்ப்பிக்கவும்",
    reviewHelp: "சமர்ப்பிப்பதற்கு முன் சரிபார்க்கவும். பின்னர் அது சரிபார்ப்பு வரிசைக்கு செல்கிறது.",
    reviewCategoryDepartment: "வகை & துறை",
    reviewCategoryLabel: "வகை",
    reviewDepartmentLabel: "துறை",
    reviewComplaintLabel: "புகார்",
    reviewTitleLabel: "தலைப்பு",
    reviewDescriptionLabel: "விவரம்",
    reviewEvidenceLabel: "ஆதாரம்",
    reviewLocationLabel: "இடம்",
    reviewAreaLabel: "பகுதி",
    reviewDistrictLabel: "மாவட்டம்",
    reviewLandmarkLabel: "அடையாள இடம்",
    reviewNotProvided: "கொடுக்கப்படவில்லை",
    reviewVerificationPrivacy: "சரிபார்ப்பு & தனியுரிமை",
    reviewPhoneLabel: "தொலைபேசி",
    accountVerified: "கணக்கு சரிபார்க்கப்பட்டது",
    otpVerified: "OTP சரிபார்க்கப்பட்டது",
    reviewIdentityLabel: "அடையாளம்",
    reviewFirstSlaLabel: "முதல் காலக்கெடு",
    reviewVerificationSla: "2 நாட்களில் சரிபார்ப்பு",
    photoVideoItems: "புகைப்படம்/வீடியோ",
    whatNextTitle: "அடுத்து என்ன நடக்கும்?",
    whatNextBody: "சரிபார்ப்பு குழு 2 நாட்களில் பார்க்கும். ஒவ்வொரு நிலையிலும் SMS மற்றும் செயலி அறிவிப்புகள் வரும்.",
    submitComplaint: "புகார் சமர்ப்பி",
    submittingComplaint: "சமர்ப்பிக்கிறது...",
    editDetails: "விவரம் திருத்து",
    confirmationTitle: "நீங்கள் விசில் ஊதிவிட்டீர்கள்!",
    complaintId: "உங்கள் புகார் எண்",
    confirmationBody: "உங்கள் புகார் சரிபார்ப்பு வரிசைக்கு சென்றது. குழு 2 நாட்களில் சரிபார்க்க வேண்டும்.",
    whatNext: "அடுத்து என்ன",
    expectDayOne: "நாள் 1-2",
    expectDayOneBody: "சரிபார்ப்பு மற்றும் அனுப்புதல்",
    expectDayTwo: "நாள் 3-9",
    expectDayTwoBody: "உள்ளூர் / MLA நிலை காலக்கெடு",
    expectDayThree: "நாள் 10+",
    expectDayThreeBody: "தீர்க்கப்படாவிட்டால் தானாக அமைச்சகத்துக்கு மேம்படுத்தப்படும்",
    trackStatus: "நிலை பார்க்க",
    done: "முடிந்தது",
    filterAll: "அனைத்தும்",
    actionNeeded: "நடவடிக்கை தேவை",
    verification: "சரிபார்ப்பு",
    escalated: "மேல்நிலை",
    resolved: "தீர்ந்தது",
    ticketLookupTitle: "தொலைபேசி மூலம் பார்க்க",
    ticketLookupHelp: "உங்கள் புகார் பதிவுகளைப் பார்க்க இந்த எண்ணை OTP மூலம் சரிபார்க்கவும்.",
    ticketLookupPhone: "தொலைபேசி எண்",
    sendOtp: "OTP அனுப்பு",
    verifyOtpShort: "சரிபார்",
    verified: "சரிபார்க்கப்பட்டது",
    syncTickets: "புதிய நிலை பெறுக",
    syncTicketsLoading: "Sync...",
    syncSavedTitle: "சேமித்த app copy",
    syncSavedBody: "சமீபத்திய புகார் பதிவுகளைப் பெற கைபேசி எண்ணைச் சரிபார்க்கவும்.",
    syncVerifyTitle: "முதலில் verify",
    syncVerifyBody: "Live ticket lookupக்கு OTP verification தேவை",
    syncCheckingTitle: "புதுப்பிப்புகளைச் சரிபார்க்கிறது",
    syncCheckingBody: "இந்த எண்ணுடன் இணைந்த புகார்களை தேடுகிறது.",
    syncLiveTitle: "Live records வந்தது",
    syncEmptyTitle: "Live records இல்லை",
    syncEmptyBody: "சேமித்த app tickets கீழே தெரியும்",
    syncOfflineTitle: "சேவை கிடைக்கவில்லை",
    syncBlockedTitle: "Sync தடுக்கப்பட்டது",
    cmCell: "CM Cell",
    queueResponsibility: "Queue பொறுப்பு",
    complaintTimeline: "புகார் நிகழ்வுகள்",
    notificationHistory: "அறிவிப்பு வரலாறு",
    addMoreInfo: "மேலும் தகவல்",
    resubmit: "மீண்டும் சரிபார்ப்பிற்கு அனுப்பு",
    reopenResolved: "எதிர்ப்பு / மீண்டும் திற",
    disputeResolution: "தீர்வு எதிர்ப்பு",
    disputeHelp: "பிரச்சினை தீர்ந்ததாக குறிக்கப்பட்டாலும் நிலைமை சரியாகவில்லை என்றால் இதைப் பயன்படுத்துங்கள்.",
    disputeReason: "இன்னும் என்ன தீர்க்கப்படவில்லை?",
    disputeEvidence: "தற்போதைய ஆதாரம் சேர்",
    submitDispute: "மதிப்பாய்விற்கு அனுப்பு",
    aggregateOnly: "தொகுப்பு தரவு மட்டும். தனிப்பட்ட தகவல் காட்டப்படாது.",
  },
} as const;

const categories: Category[] = [
  { id: "corruption", icon: ShieldAlert, group: "protected", label: { en: "Corruption", ta: "ஊழல்" }, description: { en: "Identity fully protected · Routes to vigilance", ta: "அடையாள பாதுகாப்பு · விழிப்புணர்வு பிரிவுக்கு அனுப்பப்படும்" } },
  { id: "roads", icon: Bus, group: "civic", label: { en: "Roads", ta: "சாலை" }, description: { en: "Potholes, signals, bridges, highways", ta: "குழிகள், சிக்னல்கள், பாலங்கள், நெடுஞ்சாலைகள்" } },
  { id: "water", icon: Droplets, group: "civic", label: { en: "Water", ta: "நீர்" }, description: { en: "No water, pipeline leaks, sewage overflow", ta: "தண்ணீர் இல்லை, குழாய் கசிவு, கழிவுநீர் பிரச்சினை" } },
  { id: "power", icon: Zap, group: "civic", label: { en: "Power", ta: "மின்சாரம்" }, description: { en: "Outages, safety hazards, billing", ta: "மின்தடை, பாதுகாப்பு ஆபத்து, கட்டணப் பிரச்சினை" } },
  { id: "sanitation", icon: ClipboardCheck, group: "civic", label: { en: "Sanitation", ta: "சுகாதாரம்" }, description: { en: "Garbage collection, drains, public waste", ta: "குப்பை அகற்றம், வடிகால், பொதுக் கழிவு" } },
  { id: "safety", icon: ShieldCheck, group: "civic", label: { en: "Public Safety", ta: "பாதுகாப்பு" }, description: { en: "Street lights, hazards, illegal structures", ta: "தெருவிளக்கு, ஆபத்து, அனுமதியற்ற கட்டிடங்கள்" } },
  { id: "health", icon: HeartPulse, group: "social", label: { en: "Health", ta: "சுகாதாரம்" }, description: { en: "PHC, medicine shortage, negligence", ta: "ஆரம்ப சுகாதார மையம், மருந்து பற்றாக்குறை, அலட்சியம்" } },
  { id: "education", icon: BookOpen, group: "social", label: { en: "Education", ta: "கல்வி" }, description: { en: "Schools, meals, teacher absence", ta: "பள்ளிகள், உணவு திட்டம், ஆசிரியர் வருகையின்மை" } },
  { id: "revenue", icon: FileText, group: "social", label: { en: "Revenue", ta: "வருவாய்" }, description: { en: "Patta, land records, certificates", ta: "பட்டா, நிலப் பதிவுகள், சான்றிதழ்கள்" } },
  { id: "ration", icon: Receipt, group: "social", label: { en: "Ration / PDS", ta: "ரேஷன்" }, description: { en: "Fair price shop, card, supply shortage", ta: "நியாய விலை கடை, அட்டை, பொருள் பற்றாக்குறை" } },
  { id: "other", icon: ClipboardCheck, group: "social", label: { en: "Other", ta: "மற்றவை" }, description: { en: "Anything not covered above", ta: "மேலே இல்லாத பிற புகார்கள்" } },
];

type CategoryAvailabilityMap = Record<CategoryId, CitizenCategoryAvailability>;

function fallbackCategoryAvailability(): CategoryAvailabilityMap {
  return Object.fromEntries(
    categories.map((category) => {
      const intakeStatus: CitizenCategoryAvailability["intakeStatus"] =
        category.id === "corruption" ? "protected_pilot" : category.id === "safety" || category.id === "other" ? "pilot_only" : "open";
      const message =
        intakeStatus === "protected_pilot"
          ? "Corruption complaints are accepted only into protected screening. Identity remains hidden from local levels."
          : intakeStatus === "pilot_only"
            ? `${category.label.en} complaints are not yet open to the public. This category opens after readiness checks.`
            : `${category.label.en} complaints are open for public intake.`;
      return [
        category.id,
        {
          id: category.id,
          labelEn: category.label.en,
          labelTa: category.label.ta,
          sensitivity: category.id === "corruption" ? "protected" : "identity_masked",
          enabled: true,
          intakeStatus,
          message,
        },
      ];
    }),
  ) as CategoryAvailabilityMap;
}

function mergeCategoryAvailability(items: CitizenCategoryAvailability[]): CategoryAvailabilityMap {
  const fallback = fallbackCategoryAvailability();
  for (const item of items) {
    if (isCategoryId(item.id)) fallback[item.id] = item;
  }
  return fallback;
}

function isCategorySelectable(availability: CitizenCategoryAvailability) {
  return availability.intakeStatus === "open" || availability.intakeStatus === "protected_pilot";
}

function categoryStatusLabel(availability: CitizenCategoryAvailability, copy: (typeof t)[Language]) {
  if (availability.intakeStatus === "protected_pilot") return copy.protectedPilotStatus;
  if (availability.intakeStatus === "pilot_only") return copy.pilotOnlyStatus;
  if (availability.intakeStatus === "blocked") return copy.blockedStatus;
  if (availability.intakeStatus === "disabled") return copy.disabledStatus;
  return copy.openStatus;
}

function categoryStatusMessage(availability: CitizenCategoryAvailability, copy: (typeof t)[Language]) {
  if (availability.intakeStatus === "protected_pilot") return copy.protectedPilotMessage;
  if (availability.intakeStatus === "pilot_only") return copy.pilotOnlyMessage;
  if (availability.intakeStatus === "blocked") return copy.blockedMessage;
  if (availability.intakeStatus === "disabled") return copy.disabledMessage;
  return copy.openMessage;
}

const departments: Record<CategoryId, Department[]> = {
  corruption: [
    { icon: ShieldAlert, name: { en: "Anti-Corruption Bureau", ta: "ஊழல் தடுப்பு பிரிவு" }, desc: { en: "Bribery by government officials", ta: "அரசு அலுவலர்களின் லஞ்ச புகார்" } },
    { icon: EyeOff, name: { en: "Vigilance & Anti-Corruption", ta: "விழிப்புணர்வு மற்றும் ஊழல் தடுப்பு" }, desc: { en: "Misuse of office and abuse of power", ta: "பதவி தவறாகப் பயன்படுத்தல்" } },
    { icon: Landmark, name: { en: "Lokayukta / Ombudsman", ta: "லோகாயுக்தா / ஓம்புட்ஸ்மேன்" }, desc: { en: "Complaints against public representatives", ta: "மக்கள் பிரதிநிதிகள் குறித்த புகார்" } },
    { icon: Receipt, name: { en: "PDS / Ration Corruption", ta: "ரேஷன் ஊழல்" }, desc: { en: "Ration shop fraud and quota misuse", ta: "ரேஷன் கடை மோசடி, ஒதுக்கீடு தவறான பயன்பாடு" } },
  ],
  roads: [
    { icon: Wrench, name: { en: "PWD - State Highways", ta: "பொது பணித்துறை - மாநில நெடுஞ்சாலை" }, desc: { en: "State roads, bridges and flyovers", ta: "மாநில சாலைகள், பாலங்கள், மேம்பாலங்கள்" } },
    { icon: Bus, name: { en: "Corporation / Municipality", ta: "மாநகராட்சி / நகராட்சி" }, desc: { en: "City roads and street repair", ta: "நகர சாலை மற்றும் தெரு பழுது" } },
    { icon: AlertTriangle, name: { en: "Traffic Police / Signals", ta: "போக்குவரத்து போலீஸ் / சிக்னல்கள்" }, desc: { en: "Signal malfunction and traffic flow", ta: "சிக்னல் கோளாறு மற்றும் போக்குவரத்து ஓட்டம்" } },
  ],
  water: [
    { icon: Droplets, name: { en: "TWAD Board", ta: "தமிழ்நாடு குடிநீர் வாரியம்" }, desc: { en: "Water supply schemes and pipelines", ta: "குடிநீர் திட்டங்கள் மற்றும் குழாய்கள்" } },
    { icon: Building2, name: { en: "Metro Water / Municipal Water", ta: "மெட்ரோ வாட்டர் / நகராட்சி நீர்" }, desc: { en: "City water and drainage issues", ta: "நகர நீர் மற்றும் வடிகால் பிரச்சினைகள்" } },
    { icon: AlertTriangle, name: { en: "Water Quality / Pollution", ta: "நீர் தரம் / மாசு" }, desc: { en: "Contaminated water or discharge", ta: "மாசடைந்த நீர் அல்லது வெளியேற்றம்" } },
  ],
  power: [
    { icon: Zap, name: { en: "TANGEDCO - Power Outage", ta: "டான்ஜெட்கோ - மின்தடை" }, desc: { en: "Power cuts and supply issues", ta: "மின்தடை மற்றும் மின் விநியோக பிரச்சினைகள்" } },
    { icon: Receipt, name: { en: "TANGEDCO - Meter / Billing", ta: "டான்ஜெட்கோ - மீட்டர் / கட்டணம்" }, desc: { en: "Faulty meter or wrong bill", ta: "மீட்டர் கோளாறு அல்லது தவறான கட்டணம்" } },
    { icon: AlertTriangle, name: { en: "TANGEDCO - Safety Hazard", ta: "டான்ஜெட்கோ - பாதுகாப்பு ஆபத்து" }, desc: { en: "Live wires or sparking transformer", ta: "மின் கம்பி ஆபத்து அல்லது டிரான்ஸ்பார்மர் கோளாறு" } },
  ],
  sanitation: [
    { icon: ClipboardCheck, name: { en: "Garbage Collection", ta: "குப்பை சேகரிப்பு" }, desc: { en: "Missed pickup and overflowing bins", ta: "குப்பை அகற்றப்படவில்லை, தொட்டிகள் நிரம்பியுள்ளன" } },
    { icon: Droplets, name: { en: "Storm Water Drains", ta: "மழைநீர் வடிகால்" }, desc: { en: "Blocked drains and flooding risk", ta: "அடைந்த வடிகால் மற்றும் வெள்ள ஆபத்து" } },
    { icon: Building2, name: { en: "Municipal Health Inspector", ta: "நகராட்சி சுகாதார ஆய்வாளர்" }, desc: { en: "Public hygiene and sanitation hazards", ta: "பொது சுகாதாரம் மற்றும் சுத்தம் குறித்த ஆபத்து" } },
  ],
  safety: [
    { icon: Lightbulb, name: { en: "Street Lights", ta: "தெருவிளக்குகள்" }, desc: { en: "Dark streets and broken lights", ta: "இருள் தெருக்கள் மற்றும் பழுதான விளக்குகள்" } },
    { icon: ShieldCheck, name: { en: "Police / Public Safety", ta: "போலீஸ் / பொது பாதுகாப்பு" }, desc: { en: "Harassment, safety and illegal activity", ta: "தொந்தரவு, பாதுகாப்பு, சட்டவிரோத செயல்கள்" } },
    { icon: AlertTriangle, name: { en: "Disaster / Hazard Response", ta: "பேரிடர் / ஆபத்து நடவடிக்கை" }, desc: { en: "Dangerous structures and urgent hazards", ta: "ஆபத்தான கட்டிடங்கள் மற்றும் அவசர ஆபத்துகள்" } },
  ],
  health: [
    { icon: HeartPulse, name: { en: "Primary Health Centre", ta: "ஆரம்ப சுகாதார மையம்" }, desc: { en: "PHC service gaps and medicine shortage", ta: "சேவை குறைபாடு மற்றும் மருந்து பற்றாக்குறை" } },
    { icon: Building2, name: { en: "Government Hospital", ta: "அரசு மருத்துவமனை" }, desc: { en: "Hospital services and negligence", ta: "மருத்துவமனை சேவை மற்றும் அலட்சியம்" } },
  ],
  education: [
    { icon: BookOpen, name: { en: "School Education Department", ta: "பள்ளிக் கல்வித் துறை" }, desc: { en: "Government school services", ta: "அரசு பள்ளி சேவைகள்" } },
    { icon: ClipboardCheck, name: { en: "Mid-Day Meal Scheme", ta: "மதிய உணவு திட்டம்" }, desc: { en: "Meals, nutrition and supply issues", ta: "உணவு, ஊட்டச்சத்து, விநியோக பிரச்சினைகள்" } },
  ],
  revenue: [
    { icon: FileText, name: { en: "Taluk / Revenue Office", ta: "தாலுகா / வருவாய் அலுவலகம்" }, desc: { en: "Certificates and land records", ta: "சான்றிதழ்கள் மற்றும் நிலப் பதிவுகள்" } },
    { icon: MapPin, name: { en: "Survey / Land Records", ta: "சர்வே / நிலப் பதிவுகள்" }, desc: { en: "Survey, patta and boundary issues", ta: "சர்வே, பட்டா, எல்லை பிரச்சினைகள்" } },
  ],
  ration: [
    { icon: Receipt, name: { en: "Civil Supplies Department", ta: "உணவுப் பொருள் வழங்கல் துறை" }, desc: { en: "Ration card and allocation issues", ta: "ரேஷன் அட்டை மற்றும் ஒதுக்கீடு பிரச்சினைகள்" } },
    { icon: Building2, name: { en: "Fair Price Shop", ta: "நியாய விலை கடை" }, desc: { en: "Shop conduct and stock shortage", ta: "கடை நடைமுறை மற்றும் பொருள் பற்றாக்குறை" } },
  ],
  other: [
    { icon: ClipboardCheck, name: { en: "Verification Routing Team", ta: "சரிபார்ப்பு அனுப்பும் குழு" }, desc: { en: "Let Whistle route this to the right department", ta: "சரியான துறைக்கு அனுப்ப விசில் உதவும்" } },
  ],
};

const initialForm: ComplaintForm = {
  title: "",
  description: "",
  reference: "",
  amount: "",
  officer: "",
  issueLocation: "Anna Nagar East, Chennai - 600102",
  district: "Chennai",
  area: "Anna Nagar East",
  landmark: "",
  phone: "+91 98765 43210",
  evidence: [],
  otp: "734192",
  gps: true,
};

const demoGpsLocation = {
  issueLocation: "Anna Nagar East, Chennai - 600102",
  district: "Chennai",
  area: "Anna Nagar East",
};

const tamilNaduDistricts = [
  "Ariyalur",
  "Chengalpattu",
  "Chennai",
  "Coimbatore",
  "Cuddalore",
  "Dharmapuri",
  "Dindigul",
  "Erode",
  "Kallakurichi",
  "Kancheepuram",
  "Kanyakumari",
  "Karur",
  "Krishnagiri",
  "Madurai",
  "Mayiladuthurai",
  "Nagapattinam",
  "Namakkal",
  "Nilgiris",
  "Perambalur",
  "Pudukkottai",
  "Ramanathapuram",
  "Ranipet",
  "Salem",
  "Sivaganga",
  "Tenkasi",
  "Thanjavur",
  "Theni",
  "Thoothukudi",
  "Tiruchirappalli",
  "Tirunelveli",
  "Tirupathur",
  "Tiruppur",
  "Tiruvallur",
  "Tiruvannamalai",
  "Tiruvarur",
  "Vellore",
  "Viluppuram",
  "Virudhunagar",
];

const seedTickets: Ticket[] = [
  {
    id: "WH-2024-084315",
    title: "Borewell water not reaching 3rd floor - Perambur",
    category: "water",
    state: "awaiting",
    slaState: "awaiting",
    stageLabel: "Needs more info",
    stageChip: "Awaiting You",
    created: "2 days ago",
    location: "Perambur, Chennai",
    primaryQueue: "Awaiting citizen update",
    secondaryQueues: ["Ticket Verification Team"],
    slaLabel: "Verification paused",
    slaRemaining: "Waiting for your response",
    slaProgress: 45,
    age: "2 days",
    escalations: 0,
    protectedIdentity: true,
    description: "Water supply complaint could not be verified without exact address and evidence.",
    notificationHistory: ["Verification team requested more information by SMS and in-app."],
    actionRequest: {
      title: "Verification Team Needs More Info",
      body: "Your water supply complaint could not be verified. Add these details and resubmit.",
      missing: ["Exact address or ward number", "Photo or video showing the issue", "Duration of the issue"],
    },
    timeline: [
      { icon: FileText, label: "Submitted by you", time: "2 days ago", tone: "neutral" },
      { icon: Phone, label: "Phone verified", time: "2 days ago", tone: "good" },
      { icon: AlertTriangle, label: "More info requested", time: "Today", note: "Verification needs address proof and a clearer photo.", tone: "warn" },
    ],
  },
  {
    id: "WH-2024-082104",
    title: "Construction of road after monsoon not done - T Nagar",
    category: "roads",
    state: "cmCell",
    slaState: "breached",
    stageLabel: "CM Cell",
    stageChip: "Escalated x2",
    created: "18 days ago",
    location: "T Nagar, Chennai",
    primaryQueue: "CM Cell",
    secondaryQueues: ["Highways Ministry", "Local / MLA"],
    slaLabel: "CM Cell SLA",
    slaRemaining: "3 days remaining",
    slaProgress: 70,
    age: "18 days",
    escalations: 2,
    protectedIdentity: true,
    description: "Road construction after monsoon has not started despite local and ministry escalation windows.",
    notificationHistory: [
      "Escalated to CM Cell. Your complaint has reached highest-level oversight.",
      "Escalated to Highways Ministry after local SLA breach.",
    ],
    timeline: [
      { icon: FileText, label: "Submitted by you", time: "18 days ago", tone: "neutral" },
      { icon: CheckCircle2, label: "Verified and routed to Local / MLA level", time: "16 days ago", note: "PWD ward-level team assigned. SLA: 7 days.", tone: "good" },
      { icon: ArrowLeft, label: "Local SLA breached; escalated to Highways Ministry", time: "9 days ago", note: "MLA office retains secondary visibility.", tone: "danger" },
      { icon: Landmark, label: "Ministry SLA breached; escalated to CM Cell", time: "2 days ago", note: "CM Cell is primary queue. Ministry remains secondary.", tone: "danger" },
      { icon: Clock3, label: "Awaiting CM Cell action", time: "3 days remaining", tone: "warn" },
    ],
  },
  {
    id: "WH-2024-084721",
    title: "Large pothole near Anna Nagar bus terminus",
    category: "roads",
    state: "verification",
    slaState: "onTrack",
    stageLabel: "Verification Queue",
    stageChip: "On Track",
    created: "Just now",
    location: "Anna Nagar East, Chennai",
    primaryQueue: "Ticket Verification Team",
    secondaryQueues: [],
    slaLabel: "Verification SLA",
    slaRemaining: "2 days remaining",
    slaProgress: 12,
    age: "Just now",
    escalations: 0,
    protectedIdentity: true,
    description: "New complaint is waiting for verification and routing.",
    notificationHistory: ["Complaint submitted and phone verified."],
    timeline: [
      { icon: FileText, label: "Submitted by you", time: "Just now", tone: "neutral" },
      { icon: Phone, label: "Phone verified", time: "Just now", tone: "good" },
      { icon: Clock3, label: "Ticket Verification Team reviewing", time: "SLA: 2 days", tone: "warn" },
    ],
  },
  {
    id: "WH-2024-079832",
    title: "Street light out for 3 weeks - Adyar 4th Main",
    category: "power",
    state: "resolved",
    slaState: "resolved",
    stageLabel: "Resolved",
    stageChip: "Resolved",
    created: "12 days ago",
    location: "Adyar, Chennai",
    primaryQueue: "Closed",
    secondaryQueues: ["Electricity Department"],
    slaLabel: "Closed",
    slaRemaining: "Resolved in 6 days",
    slaProgress: 100,
    age: "12 days",
    escalations: 0,
    protectedIdentity: true,
    description: "Street light was replaced and closure confirmed.",
    notificationHistory: ["Resolved by municipal electrical team.", "Closure update sent by SMS."],
    timeline: [
      { icon: FileText, label: "Submitted by you", time: "12 days ago", tone: "neutral" },
      { icon: CheckCircle2, label: "Routed to local team", time: "11 days ago", tone: "good" },
      { icon: CheckCircle2, label: "Resolved", time: "6 days after submission", tone: "good" },
    ],
  },
  {
    id: "WH-2024-084002",
    title: "Possible duplicate ration shop overcharging complaint",
    category: "ration",
    state: "rejectedReview",
    slaState: "awaiting",
    stageLabel: "Rejected - CM review",
    stageChip: "CM Review",
    created: "4 days ago",
    location: "Vellore",
    primaryQueue: "CM-maintained rejection review",
    secondaryQueues: ["Ticket Verification Team"],
    slaLabel: "Review SLA",
    slaRemaining: "Review pending",
    slaProgress: 55,
    age: "4 days",
    escalations: 0,
    protectedIdentity: true,
    description: "Rejected ticket is under independent CM-maintained quality review.",
    notificationHistory: ["Rejected ticket automatically sent to CM-maintained review queue."],
    rejection: {
      reason: "Marked as possible duplicate of another ration complaint.",
      review: "Independent review checks whether rejection was valid.",
    },
    timeline: [
      { icon: FileText, label: "Submitted by you", time: "4 days ago", tone: "neutral" },
      { icon: AlertTriangle, label: "Rejected by verification", time: "3 days ago", note: "Possible duplicate.", tone: "warn" },
      { icon: Landmark, label: "Moved to CM-maintained review", time: "3 days ago", tone: "danger" },
    ],
  },
];

const ticketStorageKey = "whistle.citizenTickets.v1";

function hydrateTickets(tickets: Ticket[]) {
  return tickets.map((ticket) => ({
    ...ticket,
    timeline: ticket.timeline.map((event) => ({
      ...event,
      icon: timelineIconFor(event.label, event.tone),
    })),
  }));
}

function loadTickets() {
  if (typeof window === "undefined") return seedTickets;
  try {
    const saved = window.localStorage.getItem(ticketStorageKey);
    if (!saved) return seedTickets;
    const parsed = JSON.parse(saved) as Ticket[];
    if (!Array.isArray(parsed) || parsed.length === 0) return seedTickets;
    return hydrateTickets(parsed);
  } catch {
    return seedTickets;
  }
}

function timelineIconFor(label: string, tone?: TimelineEvent["tone"]) {
  const lower = label.toLowerCase();
  if (lower.includes("phone") || lower.includes("sms")) return Phone;
  if (lower.includes("resubmitted")) return RotateCcw;
  if (lower.includes("cm")) return Landmark;
  if (lower.includes("escalated") || tone === "danger") return AlertTriangle;
  if (lower.includes("verified") || lower.includes("resolved") || tone === "good") return CheckCircle2;
  if (lower.includes("review") || lower.includes("awaiting")) return Clock3;
  return FileText;
}

function makeTicketId(existingCount: number) {
  const suffix = String(86000 + existingCount + (Date.now() % 900)).padStart(6, "0");
  return `WH-2026-${suffix}`;
}

function maskPhone(phone: string) {
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 4) return "verified phone";
  return `XXXXXX${digits.slice(-4)}`;
}

function phoneKey(phone: string) {
  return phone.replace(/\D/g, "").slice(-10);
}

function sessionPhoneValue(phone?: string) {
  if (!phone) return initialForm.phone;
  const trimmed = phone.trim();
  if (trimmed.startsWith("+")) return trimmed;
  return `+${trimmed}`;
}

function isCategoryId(value: string): value is CategoryId {
  return categories.some((categoryItem) => categoryItem.id === value);
}

function relativeTime(iso: string) {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (minutes < 2) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)} days ago`;
}

function ticketAge(iso: string) {
  const hours = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 36e5));
  if (hours < 1) return "Just now";
  if (hours < 48) return `${hours}h`;
  return `${Math.round(hours / 24)} days`;
}

function dueLabel(dueAt: string | null, paused: boolean) {
  if (paused) return "Waiting for citizen response";
  if (!dueAt) return "No active SLA";
  const hours = Math.round((new Date(dueAt).getTime() - Date.now()) / 36e5);
  if (hours < 0) return `${Math.abs(hours)}h overdue`;
  if (hours < 24) return `${hours}h remaining`;
  return `${Math.round(hours / 24)} days remaining`;
}

function slaProgress(ticket: TicketSpineTicket) {
  if (!ticket.sla.dueAt) return ticket.sla.paused ? 45 : 0;
  if (ticket.sla.state === "breached") return 100;
  const created = new Date(ticket.createdAt).getTime();
  const due = new Date(ticket.sla.dueAt).getTime();
  const elapsed = Date.now() - created;
  const total = Math.max(1, due - created);
  return Math.max(8, Math.min(100, Math.round((elapsed / total) * 100)));
}

function mapSpineSlaState(state: string, paused: boolean): SlaState {
  if (paused || state === "paused") return "awaiting";
  if (state === "due_soon") return "dueSoon";
  if (state === "breached") return "breached";
  if (state === "resolved") return "resolved";
  return "onTrack";
}

function mapSpineTicketState(ticket: TicketSpineTicket): TicketState {
  if (ticket.status === "resolved" || ticket.status === "closed") return "resolved";
  if (ticket.primaryQueue.kind === "citizen" || ticket.status === "needs_info") return "awaiting";
  if (ticket.primaryQueue.kind === "ministry") return "ministry";
  if (ticket.primaryQueue.kind === "cm_cell") return "cmCell";
  if (ticket.primaryQueue.kind === "rejection_review" || ticket.status === "rejected") return "rejectedReview";
  if (ticket.primaryQueue.kind === "local" || ticket.primaryQueue.kind === "mla") return "local";
  return "verification";
}

function stageLabelForSpine(ticket: TicketSpineTicket) {
  if (ticket.primaryQueue.kind === "citizen" || ticket.status === "needs_info") return "Needs more info";
  if (ticket.primaryQueue.kind === "protected_review") return "Protected Screening";
  if (ticket.primaryQueue.kind === "rejection_review") return "Rejected - CM review";
  if (ticket.primaryQueue.kind === "cm_cell") return "CM Cell";
  if (ticket.primaryQueue.kind === "ministry") return "Ministry Level";
  if (ticket.primaryQueue.kind === "local" || ticket.primaryQueue.kind === "mla") return "Local / MLA Level";
  if (ticket.status === "resolved" || ticket.status === "closed") return "Resolved";
  return "Verification Queue";
}

function stageChipForSpine(ticket: TicketSpineTicket) {
  if (ticket.protected && ticket.primaryQueue.kind === "protected_review") return "Protected";
  if (ticket.primaryQueue.kind === "citizen") return "Action Needed";
  if (ticket.primaryQueue.kind === "rejection_review") return "CM Review";
  if (ticket.sla.state === "breached") return "SLA Breach";
  if (ticket.sla.state === "due_soon") return "Due Soon";
  if (ticket.status === "resolved" || ticket.status === "closed") return "Resolved";
  return "On Track";
}

function timelineFromSpine(ticket: TicketSpineTicket): TimelineEvent[] {
  return ticket.citizenTimeline.map((event) => ({
    icon: timelineIconFor(event.message, event.type === "ticket_escalated" || event.type === "ticket_rejected" ? "danger" : undefined),
    label: event.message,
    time: relativeTime(event.createdAt),
    tone:
      event.type === "ticket_rejected" || event.type === "ticket_escalated"
        ? "danger"
        : event.type === "additional_info_requested"
          ? "warn"
          : event.type === "phone_verified" || event.type === "citizen_update_submitted" || event.type === "ticket_routed"
            ? "good"
            : "neutral",
  }));
}

function notificationsFromSpine(ticket: TicketSpineTicket, notifications?: TicketSpineNotification[]) {
  const spineMessages =
    notifications?.length
      ? notifications
          .slice()
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          .map((notification) => `${notificationChannelLabel(notification.channel)} ${notification.status}: ${notification.safeMessage}`)
      : [];
  const citizenTimelineMessages = ticket.citizenTimeline
    .slice()
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((event) => `In-app update: ${ticket.id}: ${event.message}`);
  return spineMessages.length
    ? spineMessages
    : citizenTimelineMessages.length
      ? citizenTimelineMessages
      : [`MVP ticket spine recorded this complaint and audit event.`, `${ticket.id}: ${stageLabelForSpine(ticket)}.`];
}

function notificationChannelLabel(channel: TicketSpineNotification["channel"]) {
  if (channel === "in_app") return "In-app update";
  if (channel === "sms") return "SMS update";
  return "WhatsApp update";
}

function mimeTypeFromFileName(fileName: string) {
  const lowerName = fileName.toLowerCase();
  if (lowerName.endsWith(".mp4")) return "video/mp4";
  if (lowerName.endsWith(".mov")) return "video/quicktime";
  if (lowerName.endsWith(".pdf")) return "application/pdf";
  if (lowerName.endsWith(".png")) return "image/png";
  if (lowerName.endsWith(".webp")) return "image/webp";
  if (lowerName.endsWith(".heic")) return "image/heic";
  if (lowerName.endsWith(".heif")) return "image/heif";
  if (lowerName.endsWith(".txt")) return "text/plain";
  return "image/jpeg";
}

function evidenceFileMeta(file: File): CitizenEvidenceUploadPayload {
  return {
    file,
    fileName: file.name,
    mimeType: file.type || mimeTypeFromFileName(file.name),
    sizeBytes: file.size,
  };
}

function spineTicketToCitizenTicket(ticket: TicketSpineTicket, existing?: Partial<Ticket>, notifications?: TicketSpineNotification[]): Ticket {
  const categoryId = isCategoryId(ticket.category) ? ticket.category : "other";
  const state = mapSpineTicketState(ticket);
  const slaState = mapSpineSlaState(ticket.sla.state, ticket.sla.paused);
  return {
    id: ticket.id,
    title: ticket.title,
    category: categoryId,
    state,
    slaState,
    stageLabel: stageLabelForSpine(ticket),
    stageChip: stageChipForSpine(ticket),
    created: relativeTime(ticket.createdAt),
    location: `${ticket.location.area}, ${ticket.location.district}`,
    primaryQueue: ticket.primaryQueue.ownerLabel,
    secondaryQueues: ticket.secondaryQueues.map((queue) => queue.ownerLabel),
    slaLabel: `${stageLabelForSpine(ticket)} SLA`,
    slaRemaining: dueLabel(ticket.sla.dueAt, ticket.sla.paused),
    slaProgress: slaProgress(ticket),
    age: ticketAge(ticket.createdAt),
    escalations: ticket.citizenTimeline.filter((event) => event.type === "ticket_escalated").length,
    protectedIdentity: true,
    description: ticket.description,
    department: ticket.departmentHint ?? existing?.department,
    evidenceCount: ticket.evidence.length,
    reference: ticket.reference,
    notificationHistory: notificationsFromSpine(ticket, notifications),
    timeline: timelineFromSpine(ticket),
    actionRequest:
      state === "awaiting"
        ? {
            title: "Verification Team Needs More Info",
            body: ticket.citizenTimeline.find((event) => event.type === "additional_info_requested")?.message ?? "Please add the requested details and resubmit.",
            missing: ["Updated details", "Exact address or landmark", "Supporting photo/video if available"],
          }
        : undefined,
    rejection:
      state === "rejectedReview"
        ? {
            reason: "Rejected by verification.",
            review: "Independent CM-maintained review checks whether the rejection was valid.",
          }
        : undefined,
    spineBacked: true,
    spineSyncedAt: new Date().toISOString(),
    spineSyncState: "synced",
    citizenPhone: existing?.citizenPhone,
    citizenAccessToken: existing?.citizenAccessToken,
  };
}

function mergeSpineTickets(
  current: Ticket[],
  spineTickets: TicketSpineTicket[],
  citizenPhone?: string,
  citizenAccessToken?: string,
  notificationMap?: Map<string, TicketSpineNotification[]>,
) {
  const mapped = spineTickets.map((ticket) => {
    const existing = current.find((item) => item.id === ticket.id);
    return spineTicketToCitizenTicket(
      ticket,
      {
        ...existing,
        citizenPhone: existing?.citizenPhone ?? citizenPhone,
        citizenAccessToken: existing?.citizenAccessToken ?? citizenAccessToken,
      },
      notificationMap?.get(ticket.id),
    );
  });
  const mappedIds = new Set(mapped.map((ticket) => ticket.id));
  return [...mapped, ...current.filter((ticket) => !mappedIds.has(ticket.id))];
}

function syncStateDisplay(syncState: TicketListSyncState, copy: (typeof t)[Language]) {
  const phone = syncState.maskedPhone ?? "verified phone";
  if (syncState.status === "needsVerification") {
    return {
      icon: LockKeyhole,
      tone: "warn",
      title: copy.syncVerifyTitle,
      body: syncState.message ?? `${copy.syncVerifyBody} (${phone})`,
    };
  }
  if (syncState.status === "loading") {
    return {
      icon: RotateCcw,
      tone: "neutral",
      title: copy.syncCheckingTitle,
      body: syncState.message ?? copy.syncCheckingBody,
    };
  }
  if (syncState.status === "liveLoaded") {
    const count = syncState.count ?? 0;
    return {
      icon: ShieldCheck,
      tone: "good",
      title: copy.syncLiveTitle,
      body: syncState.message ?? `${count} complaint record(s) found for ${phone}.`,
    };
  }
  if (syncState.status === "liveEmpty") {
    return {
      icon: FileText,
      tone: "empty",
      title: copy.syncEmptyTitle,
      body: syncState.message ?? `${copy.syncEmptyBody} (${phone})`,
    };
  }
  if (syncState.status === "offline") {
    return {
      icon: RadioTower,
      tone: "danger",
      title: copy.syncOfflineTitle,
      body: syncState.message ?? "The complaint service could not be reached. Saved complaints remain visible below.",
    };
  }
  if (syncState.status === "rejected") {
    return {
      icon: ShieldAlert,
      tone: "danger",
      title: copy.syncBlockedTitle,
      body: syncState.message ?? "The verified phone could not load this ticket list.",
    };
  }
  return {
    icon: Phone,
    tone: "neutral",
    title: copy.syncSavedTitle,
    body: copy.syncSavedBody,
  };
}

function ticketDetailBrief(ticket: Ticket): TicketDetailBrief {
  if (ticket.state === "awaiting") {
    return {
      tone: "action",
      icon: AlertTriangle,
      ownerLabel: "Waiting with you",
      ownerNote: "Verification is paused until the requested details are sent.",
      slaTitle: "SLA paused",
      slaNote: ticket.slaRemaining,
      escalationPath: ["You", "Verification", "Local / MLA", "Ministry", "CM Cell"],
      citizenActionTitle: "Action needed now",
      citizenActionBody: "Add the missing information to restart verification and routing.",
    };
  }
  if (ticket.state === "rejectedReview") {
    return {
      tone: "escalated",
      icon: ShieldAlert,
      ownerLabel: "CM rejection review",
      ownerNote: "A CM-maintained team checks whether the rejection was valid.",
      slaTitle: ticket.slaLabel,
      slaNote: ticket.slaRemaining,
      escalationPath: ["Verification", "Rejected", "CM review", "Reopen or close"],
      citizenActionTitle: "Watch for review result",
      citizenActionBody: "You may be asked for more proof if the review overturns or reopens the case.",
    };
  }
  if (ticket.state === "resolved") {
    return {
      tone: "resolved",
      icon: CheckCircle2,
      ownerLabel: "Closure recorded",
      ownerNote: publicDepartmentName(ticket),
      slaTitle: "SLA closed",
      slaNote: ticket.slaRemaining,
      escalationPath: ["Resolved", "Citizen review", "Dispute if needed", "Verification"],
      citizenActionTitle: "Confirm ground reality",
      citizenActionBody: "If the issue is still not fixed, dispute the closure and send current proof.",
    };
  }
  if (ticket.state === "cmCell") {
    return {
      tone: "escalated",
      icon: Landmark,
      ownerLabel: "CM Cell primary",
      ownerNote: "State oversight owns the escalation while earlier owners remain visible.",
      slaTitle: ticket.slaLabel,
      slaNote: ticket.slaRemaining,
      escalationPath: ["Local / MLA", "Ministry", "CM Cell", "Directive"],
      citizenActionTitle: "No action needed",
      citizenActionBody: "Track updates here. The ministry and CM Cell remain accountable until closure.",
    };
  }
  if (ticket.state === "ministry") {
    return {
      tone: "escalated",
      icon: Building2,
      ownerLabel: "Ministry primary",
      ownerNote: publicDepartmentName(ticket),
      slaTitle: ticket.slaLabel,
      slaNote: ticket.slaRemaining,
      escalationPath: ["Local / MLA", "Ministry", "CM Cell"],
      citizenActionTitle: "Track ministry action",
      citizenActionBody: "The local owner remains visible, but the ministry is now responsible for clearing the delay.",
    };
  }
  if (ticket.state === "local") {
    return {
      tone: "watch",
      icon: MapPin,
      ownerLabel: "Local / MLA owner",
      ownerNote: publicDepartmentName(ticket),
      slaTitle: ticket.slaLabel,
      slaNote: ticket.slaRemaining,
      escalationPath: ["Local / MLA", "Ministry", "CM Cell"],
      citizenActionTitle: "Watch local SLA",
      citizenActionBody: "If the local SLA breaches, the ticket escalates while local visibility remains.",
    };
  }
  return {
    tone: "watch",
    icon: Clock3,
    ownerLabel: "Verification Team",
    ownerNote: "Checking category, location, evidence, and routing.",
    slaTitle: ticket.slaLabel,
    slaNote: ticket.slaRemaining,
    escalationPath: ["Verification", "Local / MLA", "Ministry", "CM Cell"],
    citizenActionTitle: "No action needed yet",
    citizenActionBody: "Watch for a routing update or a request for more information.",
  };
}

function App({ authSession }: { authSession?: WhistleAuthSession }) {
  const [language, setLanguage] = useState<Language>("en");

  // Keep the document language in step with the UI toggle so screen readers
  // switch pronunciation rules (WCAG 3.1.1, UX audit item 2.5).
  useEffect(() => {
    document.documentElement.lang = language === "ta" ? "ta" : "en";
  }, [language]);
  const [screen, setScreen] = useState<Screen>("home");
  const [category, setCategory] = useState<CategoryId>("roads");
  const [selectedCategoryFeedback, setSelectedCategoryFeedback] = useState<CategoryId | null>(null);
  const [department, setDepartment] = useState(departments.roads[0].name.en);
  const sessionPhone = sessionPhoneValue(authSession?.phone);
  const [form, setForm] = useState<ComplaintForm>(() => ({ ...initialForm, phone: sessionPhone }));
  const [citizenPhone, setCitizenPhone] = useState(sessionPhone);
  const [tickets, setTickets] = useState<Ticket[]>(loadTickets);
  const [selectedTicketId, setSelectedTicketId] = useState(loadTickets()[1]?.id ?? seedTickets[0].id);
  const [ticketFilter, setTicketFilter] = useState<"all" | "action" | "verification" | "escalated" | "resolved">("all");
  const [latestId, setLatestId] = useState("WH-2024-084721");
  const [submissionError, setSubmissionError] = useState<string | null>(null);
  const [isSubmittingComplaint, setIsSubmittingComplaint] = useState(false);
  const [otpState, setOtpState] = useState<OtpState>(() =>
    authSession?.phoneVerificationToken
      ? {
          status: "verified",
          phoneMasked: authSession.phoneMasked,
          verificationToken: authSession.phoneVerificationToken,
          message: `Phone verified for ${authSession.phoneMasked}.`,
        }
      : { status: "idle" },
  );
  const [ticketLookupOtp, setTicketLookupOtp] = useState("");
  const [ticketLookupOtpState, setTicketLookupOtpState] = useState<OtpState>({ status: "idle" });
  const [complaintDraftKey, setComplaintDraftKey] = useState(() => newClientNonce("citizen-create"));
  const [addInfoDraftKeys, setAddInfoDraftKeys] = useState<Record<string, string>>({});
  const [reopenDraftKeys, setReopenDraftKeys] = useState<Record<string, string>>({});
  const [ticketListSyncing, setTicketListSyncing] = useState(false);
  const [ticketListSyncState, setTicketListSyncState] = useState<TicketListSyncState>({ status: "idle" });
  const [syncingTicketId, setSyncingTicketId] = useState<string | null>(null);
  const [syncNotice, setSyncNotice] = useState<string | null>(null);
  const [categoryAvailability, setCategoryAvailability] = useState<CategoryAvailabilityMap>(() => fallbackCategoryAvailability());
  const [categoryConfigSyncState, setCategoryConfigSyncState] = useState<"loading" | "synced" | "offline">("loading");
  const [assetPolicy, setAssetPolicy] = useState<PublicAssetPolicy>(initialAssetPolicy);
  const [citizenPhoneOtpRequired, setCitizenPhoneOtpRequired] = useState(true);
  const [categoryNotice, setCategoryNotice] = useState<string | null>(null);
  const copy = t[language];
  const selectedCategory = categories.find((item) => item.id === category) ?? categories[1];
  const selectedTicket = tickets.find((ticket) => ticket.id === selectedTicketId) ?? tickets[0];

  const citizenAccessForTicket = (ticket: Ticket) => ({
    phone: ticket.citizenPhone ?? citizenPhone,
    phoneVerificationToken: ticket.citizenAccessToken,
  });

  useEffect(() => {
    window.localStorage.setItem(ticketStorageKey, JSON.stringify(tickets));
  }, [tickets]);

  useEffect(() => {
    let active = true;
    async function loadCitizenConfig() {
      const result = await fetchCitizenConfig();
      if (!active) return;
      if (!result.ok) {
        setCategoryConfigSyncState("offline");
        return;
      }
      setAssetPolicy(result.data.assetPolicy);
      setCategoryAvailability(mergeCategoryAvailability(result.data.categories));
      setCitizenPhoneOtpRequired(result.data.controls?.phoneOtpRequired !== false);
      setCategoryConfigSyncState("synced");
    }
    void loadCitizenConfig();
    return () => {
      active = false;
    };
  }, []);

  const go = (next: Screen) => {
    setScreen(next);
    requestAnimationFrame(() => {
      document.querySelector(".screen-body")?.scrollTo({ top: 0, behavior: "smooth" });
    });
  };

  const signedInCitizenPhoneMatches =
    authSession?.role === "citizen" && phoneKey(authSession.phone) === phoneKey(form.phone);
  const currentPhoneVerified =
    !citizenPhoneOtpRequired ||
    signedInCitizenPhoneMatches ||
    (otpState.status === "verified" && phoneKey(form.phone) === phoneKey(sessionPhone));
  const needsComplaintPhoneOtp = citizenPhoneOtpRequired && !currentPhoneVerified;

  const continueAfterLocation = () => {
    go(needsComplaintPhoneOtp ? "otp" : "review");
  };

  const chooseCategory = (nextCategory: CategoryId) => {
    const availability = categoryAvailability[nextCategory];
    if (!isCategorySelectable(availability)) {
      setCategory(nextCategory);
      setSelectedCategoryFeedback(nextCategory);
      setCategoryNotice(categoryStatusMessage(availability, copy) || copy.categoryNotOpen);
      go("category");
      return;
    }
    setCategoryNotice(null);
    setSubmissionError(null);
    setCategory(nextCategory);
    setSelectedCategoryFeedback(nextCategory);
    setDepartment(departments[nextCategory][0].name[language]);
    window.setTimeout(() => {
      setSelectedCategoryFeedback(null);
      go("department");
    }, 520);
  };

  const syncCitizenTicketsFromSpine = async (overrideToken?: string) => {
    setTicketListSyncing(true);
    setTicketListSyncState({
      status: "loading",
      maskedPhone: maskPhone(citizenPhone),
    });
    const matchingAccess = tickets.find(
      (ticket) => ticket.citizenAccessToken && ticket.citizenPhone && phoneKey(ticket.citizenPhone) === phoneKey(citizenPhone),
    );
    const activeOtpToken = phoneKey(form.phone) === phoneKey(citizenPhone) ? otpState.verificationToken : undefined;
    const sessionTokenForPhone = phoneKey(authSession?.phone ?? "") === phoneKey(citizenPhone) ? authSession?.phoneVerificationToken : undefined;
    const phoneVerificationToken = overrideToken ?? matchingAccess?.citizenAccessToken ?? ticketLookupOtpState.verificationToken ?? activeOtpToken ?? sessionTokenForPhone;
    if (citizenPhoneOtpRequired && !phoneVerificationToken) {
      setTicketListSyncing(false);
      setTicketListSyncState({
        status: "needsVerification",
        maskedPhone: maskPhone(citizenPhone),
      });
      return;
    }
    const ticketResult = await fetchCitizenTicketsFromSpine(citizenPhone, {
      phone: citizenPhone,
      phoneVerificationToken,
    });
    if (!ticketResult.ok) {
      setTicketListSyncing(false);
      setTicketListSyncState({
        status: ticketResult.kind === "unavailable" ? "offline" : "rejected",
        maskedPhone: maskPhone(citizenPhone),
        message:
          ticketResult.kind === "unavailable"
            ? "Complaint service unavailable. Showing saved complaints on this phone."
            : ticketResult.message,
      });
      return;
    }
    const notificationEntries = await Promise.all(
      ticketResult.data.tickets.map(async (ticket) => {
        const result = await fetchTicketNotificationsFromSpine(ticket.id, { phone: citizenPhone, phoneVerificationToken });
        return [ticket.id, result.ok ? result.data.notifications : undefined] as const;
      }),
    );
    const notificationMap = new Map(
      notificationEntries.flatMap(([ticketId, notifications]) => (notifications ? [[ticketId, notifications] as const] : [])),
    );
    setTickets((current) => mergeSpineTickets(current, ticketResult.data.tickets, citizenPhone, phoneVerificationToken, notificationMap));
    setTicketListSyncing(false);
    setTicketListSyncState({
      status: ticketResult.data.tickets.length ? "liveLoaded" : "liveEmpty",
      count: ticketResult.data.tickets.length,
      maskedPhone: maskPhone(citizenPhone),
    });
  };

  const updateTicketLookupPhone = (phone: string) => {
    setCitizenPhone(phone);
    setTicketLookupOtp("");
    setTicketLookupOtpState({ status: "idle" });
    setTicketListSyncState({ status: "idle", maskedPhone: maskPhone(phone) });
  };

  const sendTicketLookupOtp = async () => {
    const phoneValid = citizenPhone.replace(/\D/g, "").length >= 10;
    if (!phoneValid) {
      setTicketLookupOtpState({ status: "error", message: "Enter a valid 10 digit phone number first." });
      return;
    }
    setTicketLookupOtpState({ status: "sending", message: "Sending verification code..." });
    const result = await startMockOtpChallenge(citizenPhone, language);
    if (!result.ok) {
      setTicketLookupOtpState({
        status: "error",
        message: result.kind === "unavailable" ? "OTP service unavailable. Showing saved tickets only." : result.message,
      });
      return;
    }
    setTicketLookupOtp(result.data.challenge.mockOtp ?? "");
    setTicketLookupOtpState({
      status: "sent",
      challengeId: result.data.challenge.challengeId,
      phoneMasked: result.data.challenge.phoneMasked,
      mockOtp: result.data.challenge.mockOtp,
      message: result.data.challenge.mockOtp
        ? `Verification code sent to ${result.data.challenge.phoneMasked}.`
        : `OTP sent to ${result.data.challenge.phoneMasked}.`,
    });
  };

  const verifyTicketLookupOtp = async () => {
    if (!ticketLookupOtpState.challengeId) {
      setTicketLookupOtpState({ status: "error", message: "Send the OTP first." });
      return;
    }
    setTicketLookupOtpState((current) => ({ ...current, status: "verifying", message: "Verifying OTP..." }));
    const result = await verifyMockOtpChallenge(ticketLookupOtpState.challengeId, ticketLookupOtp);
    if (!result.ok) {
      setTicketLookupOtpState((current) => ({
        ...current,
        status: "error",
        message: result.kind === "unavailable" ? "OTP verification service unavailable." : result.message,
      }));
      return;
    }
    setTicketLookupOtpState((current) => ({
      ...current,
      status: "verified",
      verificationToken: result.data.verification.verificationToken,
      phoneMasked: result.data.verification.phoneMasked,
      message: `Phone verified for ${result.data.verification.phoneMasked}.`,
    }));
    await syncCitizenTicketsFromSpine(result.data.verification.verificationToken);
  };

  const resetPhoneVerification = () => {
    setOtpState({ status: "idle" });
  };

  const sendMockOtp = async () => {
    const phoneValid = form.phone.replace(/\D/g, "").length >= 10;
    if (!phoneValid) {
      setOtpState({ status: "error", message: "Enter a valid 10 digit phone number first." });
      return;
    }
    setOtpState({ status: "sending", message: "Sending verification code..." });
    const result = await startMockOtpChallenge(form.phone, language);
    if (!result.ok) {
      if (result.kind === "unavailable") {
        setForm((current) => ({ ...current, otp: "123456" }));
        setOtpState({
          status: "sent",
          challengeId: `local_${Date.now().toString(36)}`,
          phoneMasked: maskPhone(form.phone),
          mockOtp: "123456",
          message: "Local UAT verification code ready.",
        });
        return;
      }
      setOtpState({
        status: "error",
        message: result.message,
      });
      return;
    }
    setForm((current) => ({ ...current, otp: result.data.challenge.mockOtp ?? "" }));
    setOtpState({
      status: "sent",
      challengeId: result.data.challenge.challengeId,
      phoneMasked: result.data.challenge.phoneMasked,
      mockOtp: result.data.challenge.mockOtp,
      message: result.data.challenge.mockOtp
        ? `Verification code sent to ${result.data.challenge.phoneMasked}.`
        : `OTP sent to ${result.data.challenge.phoneMasked}.`,
    });
  };

  const verifyOtpAndReview = async () => {
    if (!otpState.challengeId) {
      setOtpState({ status: "error", message: "Send the OTP first." });
      return;
    }
    if (otpState.challengeId.startsWith("local_")) {
      if (form.otp !== "123456") {
        setOtpState((current) => ({ ...current, status: "error", message: "The local UAT verification code is 123456." }));
        return;
      }
      setOtpState((current) => ({
        ...current,
        status: "verified",
        verificationToken: "local_mock_verified",
        message: `Phone verified locally for ${current.phoneMasked ?? maskPhone(form.phone)}.`,
      }));
      go("review");
      return;
    }
    setOtpState((current) => ({ ...current, status: "verifying", message: "Verifying OTP..." }));
    const result = await verifyMockOtpChallenge(otpState.challengeId, form.otp);
    if (!result.ok) {
      setOtpState((current) => ({
        ...current,
        status: "error",
        message: result.kind === "unavailable" ? "OTP verification service unavailable." : result.message,
      }));
      return;
    }
    setOtpState((current) => ({
      ...current,
      status: "verified",
      verificationToken: result.data.verification.verificationToken,
      phoneMasked: result.data.verification.phoneMasked,
      message: `Phone verified for ${result.data.verification.phoneMasked}.`,
    }));
    go("review");
  };

  const submitComplaint = async () => {
    if (isSubmittingComplaint) return;
    setSubmissionError(null);
    setIsSubmittingComplaint(true);
    try {
      const isCorruption = category === "corruption";
      const evidenceItems = form.evidence;
      const ticketPayload = {
        category,
        language,
        title: form.title.trim(),
        description: form.description.trim(),
        phone: form.phone,
        phoneVerificationToken: otpState.verificationToken,
        reference: form.reference.trim() || undefined,
        departmentHint: department,
        location: {
          district: form.district,
          area: form.area,
          address: form.issueLocation,
          landmark: form.landmark || undefined,
        },
        evidence: [],
      };
      const ticketSpineResult = await createTicketInSpine(ticketPayload, { idempotencyKey: complaintDraftKey });
      if (!ticketSpineResult.ok && ticketSpineResult.kind === "rejected") {
        setSubmissionError(ticketSpineResult.message);
        return;
      }
      const ticketSpineData = ticketSpineResult.ok ? ticketSpineResult.data : null;
      let ticketForDisplay = ticketSpineData?.ticket ?? null;
      let evidenceNotice: string | null = null;
      if (ticketForDisplay && evidenceItems.length > 0) {
        const uploadResult = await uploadCitizenEvidenceToSpine(ticketForDisplay.id, evidenceItems, {
          phone: form.phone,
          phoneVerificationToken: otpState.verificationToken,
        });
        if (uploadResult.ok) {
          ticketForDisplay = uploadResult.data.ticket;
          evidenceNotice = `${uploadResult.data.uploadedCount} evidence item(s) uploaded and queued for secure scan.`;
        } else {
          evidenceNotice =
            uploadResult.kind === "unavailable"
              ? `${uploadResult.uploadedCount}/${evidenceItems.length} evidence item(s) uploaded. Evidence service unavailable; add missing proof from the ticket later.`
              : `${uploadResult.uploadedCount}/${evidenceItems.length} evidence item(s) uploaded. ${uploadResult.message}`;
        }
      }
      const newId = ticketForDisplay?.id ?? makeTicketId(tickets.length);
      const newTicket: Ticket = ticketSpineData
        ? spineTicketToCitizenTicket(ticketForDisplay ?? ticketSpineData.ticket, {
            department,
            citizenPhone: form.phone,
            citizenAccessToken: otpState.verificationToken,
          })
        : {
            ...seedTickets[2],
            id: newId,
            title: form.title.trim(),
            category,
            department,
            created: "Just now",
            age: "Just now",
            location: `${form.area}, ${form.district}`,
            description: form.description.trim(),
            evidenceCount: form.evidence.length,
            reference: form.reference.trim(),
            primaryQueue: isCorruption ? "Protected verification queue" : "Ticket Verification Team",
            secondaryQueues: [],
            protectedIdentity: true,
            stageLabel: isCorruption ? "Protected Screening" : "Verification Queue",
            stageChip: isCorruption ? "Protected" : "On Track",
            notificationHistory: [
              "Complaint submitted in Whistle.",
              "Saved on this phone because the complaint service was not reachable.",
              `Phone verified for ${maskPhone(form.phone)}.`,
              isCorruption ? "Protected route enabled. Local bodies cannot view this complaint yet." : "Ticket moved to verification queue.",
            ],
            timeline: [
              { icon: FileText, label: "Submitted by you", time: "Just now", tone: "neutral" },
              { icon: Phone, label: "Phone verified", time: "Just now", tone: "good" },
              {
                icon: isCorruption ? ShieldAlert : Clock3,
                label: isCorruption ? "Protected screening started" : "Ticket Verification Team reviewing",
                time: "SLA: 2 days",
                note: isCorruption ? "Identity remains masked until vigilance-level review." : undefined,
                tone: isCorruption ? "danger" : "warn",
              },
            ],
          };
      if (evidenceNotice) {
        newTicket.notificationHistory = [evidenceNotice, ...newTicket.notificationHistory];
      }
      setTickets((current) => [newTicket, ...current]);
      setSelectedTicketId(newId);
      setLatestId(newId);
      setTicketFilter("all");
      setCitizenPhone(form.phone);
      setForm({ ...initialForm, phone: sessionPhone });
      setOtpState({ status: "idle" });
      setComplaintDraftKey(newClientNonce("citizen-create"));
      go("confirmation");
    } finally {
      setIsSubmittingComplaint(false);
    }
  };

  const refreshTicketFromSpine = async (ticketId = selectedTicket.id) => {
    const target = tickets.find((ticket) => ticket.id === ticketId);
    if (!target?.spineBacked) return;
    setSyncingTicketId(ticketId);
    setSyncNotice(null);
    const access = citizenAccessForTicket(target);
    const ticketResult = await fetchTicketFromSpine(ticketId, access);
    if (!ticketResult.ok) {
      const syncState = ticketResult.kind === "not_found" ? "notFound" : "offline";
      setTickets((current) =>
        current.map((ticket) =>
          ticket.id === ticketId
            ? {
                ...ticket,
                spineSyncState: syncState,
                notificationHistory: [
                  ticketResult.kind === "not_found"
                    ? "Could not find this complaint in the live system."
                    : "Complaint service unavailable. Showing last saved copy.",
                  ...ticket.notificationHistory,
                ],
              }
            : ticket,
        ),
      );
      setSyncNotice(ticketResult.kind === "not_found" ? "Complaint not found in the live system." : "Could not reach the complaint service.");
      setSyncingTicketId(null);
      return;
    }

    const notificationResult = await fetchTicketNotificationsFromSpine(ticketId, access);
    const notifications = notificationResult.ok ? notificationResult.data.notifications : undefined;
    setTickets((current) =>
      current.map((ticket) =>
        ticket.id === ticketId ? spineTicketToCitizenTicket(ticketResult.data.ticket, ticket, notifications) : ticket,
      ),
    );
    setSyncNotice("Latest complaint status loaded.");
    setSyncingTicketId(null);
  };

  const resubmitInfo = async (payload: AddInfoPayload) => {
    if (selectedTicket.spineBacked) {
      let idempotencyKey = addInfoDraftKeys[selectedTicket.id];
      if (!idempotencyKey) {
        idempotencyKey = newClientNonce("citizen-update");
        setAddInfoDraftKeys((current) => ({ ...current, [selectedTicket.id]: idempotencyKey }));
      }
      const access = citizenAccessForTicket(selectedTicket);
      const ticketSpineResult = await submitCitizenUpdateInSpine(selectedTicket.id, {
        details: payload.details,
        address: payload.address || undefined,
        evidence: Array.from({ length: payload.evidenceCount }, (_, index) => ({
          fileName: `citizen-update-${index + 1}.jpg`,
          mimeType: "image/jpeg",
          sizeBytes: 650_000,
        })),
      }, { idempotencyKey, ...access });
      if (!ticketSpineResult.ok && ticketSpineResult.kind === "rejected") {
        return ticketSpineResult.message;
      }
      if (ticketSpineResult.ok) {
        const notificationResult = await fetchTicketNotificationsFromSpine(selectedTicket.id, access);
        const notifications = notificationResult.ok ? notificationResult.data.notifications : undefined;
        setTickets((current) =>
          current.map((ticket) =>
            ticket.id === selectedTicket.id ? spineTicketToCitizenTicket(ticketSpineResult.data.ticket, ticket, notifications) : ticket,
          ),
        );
        setTicketFilter("verification");
        setAddInfoDraftKeys((current) => {
          const { [selectedTicket.id]: _usedKey, ...rest } = current;
          return rest;
        });
        go("tickets");
        return null;
      }
    }
    setTickets((current) =>
      current.map((ticket) =>
        ticket.id === selectedTicket.id
          ? {
              ...ticket,
              state: "verification",
              slaState: "onTrack",
              stageLabel: "Verification Queue",
              stageChip: "Resubmitted",
              primaryQueue: "Ticket Verification Team",
              actionRequest: undefined,
              location: payload.address || ticket.location,
              evidenceCount: (ticket.evidenceCount ?? 0) + payload.evidenceCount,
              description: `${ticket.description}\n\nCitizen update: ${payload.details}`,
              notificationHistory: [
                "Additional information submitted. Ticket returned to verification.",
                ...ticket.notificationHistory,
              ],
              timeline: [
                ...ticket.timeline,
                { icon: RotateCcw, label: "Resubmitted by you", time: "Just now", note: "Additional details returned this ticket to verification.", tone: "good" },
              ],
            }
          : ticket,
      ),
    );
    setTicketFilter("verification");
    go("tickets");
    return null;
  };

  const submitReopenDispute = async (payload: ReopenDisputePayload) => {
    if (selectedTicket.spineBacked) {
      let idempotencyKey = reopenDraftKeys[selectedTicket.id];
      if (!idempotencyKey) {
        idempotencyKey = newClientNonce("citizen-dispute");
        setReopenDraftKeys((current) => ({ ...current, [selectedTicket.id]: idempotencyKey }));
      }
      const access = citizenAccessForTicket(selectedTicket);
      const ticketSpineResult = await submitCitizenDisputeInSpine(selectedTicket.id, {
        reason: payload.reason,
        evidence: Array.from({ length: payload.evidenceCount }, (_, index) => ({
          label: "after",
          fileName: `closure-dispute-${index + 1}.jpg`,
          mimeType: "image/jpeg",
          sizeBytes: 650_000,
        })),
      }, { idempotencyKey, ...access });
      if (!ticketSpineResult.ok && ticketSpineResult.kind === "rejected") {
        return ticketSpineResult.message;
      }
      if (ticketSpineResult.ok) {
        const notificationResult = await fetchTicketNotificationsFromSpine(selectedTicket.id, access);
        const notifications = notificationResult.ok ? notificationResult.data.notifications : undefined;
        setTickets((current) =>
          current.map((ticket) =>
            ticket.id === selectedTicket.id ? spineTicketToCitizenTicket(ticketSpineResult.data.ticket, ticket, notifications) : ticket,
          ),
        );
        setTicketFilter("verification");
        setReopenDraftKeys((current) => {
          const { [selectedTicket.id]: _usedKey, ...rest } = current;
          return rest;
        });
        go("tickets");
        return null;
      }
    }

    setTickets((current) =>
      current.map((ticket) =>
        ticket.id === selectedTicket.id
          ? {
              ...ticket,
              state: "verification",
              slaState: "onTrack",
              stageLabel: "Verification Queue",
              stageChip: "Reopened",
              primaryQueue: "Ticket Verification Team",
              secondaryQueues: Array.from(new Set([ticket.primaryQueue, ...ticket.secondaryQueues, "CM Cell oversight"])).filter((queue) => queue !== "Closed"),
              slaLabel: "Reopen Review SLA",
              slaRemaining: "2 days remaining",
              slaProgress: 8,
              escalations: ticket.escalations + 1,
              evidenceCount: (ticket.evidenceCount ?? 0) + payload.evidenceCount,
              description: `${ticket.description}\n\nCitizen dispute: ${payload.reason}`,
              notificationHistory: [
                "Closure dispute submitted. Ticket returned to verification with CM Cell oversight visibility.",
                ...ticket.notificationHistory,
              ],
              timeline: [
                ...ticket.timeline,
                {
                  icon: RotateCcw,
                  label: "Disputed and reopened by you",
                  time: "Just now",
                  note: "Verification will review the closure evidence and route it back if action is still pending.",
                  tone: "warn",
                },
              ],
              spineSyncState: ticket.spineBacked ? "offline" : ticket.spineSyncState,
            }
          : ticket,
      ),
    );
    setTicketFilter("verification");
    go("tickets");
    return null;
  };

  return (
    <div className="device-stage">
      <div className="phone-shell">
        {/* Decorative status bar belongs to the standalone mockup exports only;
            real devices already have one (UX audit item 2.3). */}
        {window.__WHISTLE_API_DISABLED__ === true && <StatusBar />}
        {screen === "home" && (
          <HomeScreen
            assetPolicy={assetPolicy}
            categoryAvailability={categoryAvailability}
            categoryConfigSyncState={categoryConfigSyncState}
            chooseCategory={chooseCategory}
            copy={copy}
            go={go}
            language={language}
            setLanguage={setLanguage}
            tickets={tickets}
          />
        )}
        {screen === "category" && (
          <CategoryScreen
            categoryAvailability={categoryAvailability}
            categoryConfigSyncState={categoryConfigSyncState}
            categoryNotice={categoryNotice}
            chooseCategory={chooseCategory}
            copy={copy}
            go={go}
            language={language}
            selectedCategory={selectedCategoryFeedback}
            setLanguage={setLanguage}
          />
        )}
        {screen === "department" && (
          <DepartmentScreen category={selectedCategory} copy={copy} department={department} go={go} language={language} setDepartment={setDepartment} />
        )}
        {screen === "details" && (
          <DetailsScreen category={category} copy={copy} form={form} go={go} setForm={setForm} />
        )}
        {screen === "location" && (
          <LocationScreen copy={copy} form={form} go={go} onContinue={continueAfterLocation} phoneOtpRequired={needsComplaintPhoneOtp} setForm={setForm} />
        )}
        {screen === "otp" && (
          <OtpScreen
            copy={copy}
            form={form}
            go={go}
            onPhoneChanged={resetPhoneVerification}
            onSendOtp={sendMockOtp}
            onVerifyOtp={verifyOtpAndReview}
            otpState={otpState}
            setForm={setForm}
          />
        )}
        {screen === "review" && (
          <ReviewScreen
            category={selectedCategory}
            copy={copy}
            department={department}
            form={form}
            go={go}
            isSubmitting={isSubmittingComplaint}
            language={language}
            phoneOtpRequired={needsComplaintPhoneOtp}
            submissionError={submissionError}
            submitComplaint={submitComplaint}
          />
        )}
        {screen === "confirmation" && (
          <ConfirmationScreen copy={copy} go={go} latestId={latestId} />
        )}
        {screen === "tickets" && (
          <TicketsScreen
            citizenPhone={citizenPhone}
            copy={copy}
            go={go}
            lookupOtp={ticketLookupOtp}
            lookupOtpState={ticketLookupOtpState}
            onLookupPhoneChange={updateTicketLookupPhone}
            onLookupOtpChange={setTicketLookupOtp}
            sendLookupOtp={sendTicketLookupOtp}
            selectedTicketId={selectedTicketId}
            setSelectedTicketId={setSelectedTicketId}
            setTicketFilter={setTicketFilter}
            syncCitizenTickets={syncCitizenTicketsFromSpine}
            ticketFilter={ticketFilter}
            ticketListSyncing={ticketListSyncing}
            ticketListSyncState={ticketListSyncState}
            tickets={tickets}
            verifyLookupOtp={verifyTicketLookupOtp}
          />
        )}
        {screen === "ticketDetail" && (
          <TicketDetailScreen copy={copy} go={go} refreshTicket={refreshTicketFromSpine} syncNotice={syncNotice} syncingTicketId={syncingTicketId} ticket={selectedTicket} />
        )}
        {screen === "addInfo" && (
          <AddInfoScreen copy={copy} go={go} resubmitInfo={resubmitInfo} ticket={selectedTicket} />
        )}
        {screen === "reopenDispute" && (
          <ReopenDisputeScreen copy={copy} go={go} submitReopenDispute={submitReopenDispute} ticket={selectedTicket} />
        )}
        {screen === "insights" && (
          <InsightsScreen copy={copy} go={go} tickets={tickets} />
        )}
      </div>
    </div>
  );
}

function StatusBar() {
  return (
    <div className="status-bar" aria-hidden="true">
      <span>9:41</span>
      <div className="status-icons">
        <span />
        <span />
        <span />
      </div>
    </div>
  );
}

function AppHeader({
  copy,
  language,
  setLanguage,
  title,
  onBack,
}: {
  copy: (typeof t)[Language];
  language?: Language;
  setLanguage?: (language: Language) => void;
  title: string;
  onBack?: () => void;
}) {
  return (
    <header className="app-header">
      {onBack ? (
        <button className="back-btn" type="button" onClick={onBack}>
          <ArrowLeft size={18} />
          {copy.back}
        </button>
      ) : (
        <strong>{title}</strong>
      )}
      {onBack && <strong>{title}</strong>}
      {language && setLanguage ? <LanguageToggle language={language} setLanguage={setLanguage} /> : <span />}
    </header>
  );
}

function LanguageToggle({ language, setLanguage }: { language: Language; setLanguage: (language: Language) => void }) {
  return (
    <div className="lang-toggle" aria-label="Language">
      <Languages size={15} />
      <button className={language === "en" ? "active" : ""} onClick={() => setLanguage("en")} type="button">
        EN
      </button>
      <button className={language === "ta" ? "active" : ""} onClick={() => setLanguage("ta")} type="button">
        த
      </button>
    </div>
  );
}

function BottomNav({ active, copy, go }: { active: "home" | "raise" | "tickets" | "insights"; copy: (typeof t)[Language]; go: (screen: Screen) => void }) {
  return (
    <nav className="bottom-nav" aria-label="Primary">
      <NavItem active={active === "home"} icon={Home} label={copy.home} onClick={() => go("home")} />
      <NavItem active={active === "raise"} icon={Megaphone} label={copy.raise} onClick={() => go("category")} />
      <NavItem active={active === "tickets"} icon={FileText} label={copy.tickets} onClick={() => go("tickets")} />
      <NavItem active={active === "insights"} icon={BarChart3} label={copy.insights} onClick={() => go("insights")} />
    </nav>
  );
}

function NavItem({ active, icon: Icon, label, onClick }: { active: boolean; icon: typeof Home; label: string; onClick: () => void }) {
  return (
    <button className={active ? "nav-item active" : "nav-item"} onClick={onClick} type="button">
      <Icon size={22} />
      <span>{label}</span>
    </button>
  );
}

function HomeScreen({
  assetPolicy,
  categoryAvailability,
  categoryConfigSyncState,
  chooseCategory,
  copy,
  go,
  language,
  setLanguage,
  tickets,
}: {
  assetPolicy: PublicAssetPolicy;
  categoryAvailability: CategoryAvailabilityMap;
  categoryConfigSyncState: "loading" | "synced" | "offline";
  chooseCategory: (category: CategoryId) => void;
  copy: (typeof t)[Language];
  go: (screen: Screen) => void;
  language: Language;
  setLanguage: (language: Language) => void;
  tickets: Ticket[];
}) {
  const activeCount = tickets.filter((ticket) => ticket.state !== "resolved").length;
  const actionCount = tickets.filter((ticket) => ticket.state === "awaiting").length;
  return (
    <section className="screen active">
      <div className="screen-body">
        <div className="home-logo">
          <div className="logo-group">
            {assetPolicy.logo.src ? (
              <img src={assetPolicy.logo.src} alt="" />
            ) : (
              <span className="asset-mark logo-fallback" aria-label={assetPolicy.logo.label}>
                W
              </span>
            )}
            <div>
              <div className="logo-ta">{copy.appNameTa}</div>
              <div className="logo-en">{copy.appName.toUpperCase()}</div>
            </div>
          </div>
          <div className="govt-seal" role="img" aria-label="Neutral civic service mark">
            {assetPolicy.emblem.src ? <img src={assetPolicy.emblem.src} alt="" /> : <span>{assetPolicy.emblem.fallbackLabel}</span>}
          </div>
          <LanguageToggle language={language} setLanguage={setLanguage} />
        </div>

        <div className="home-hero">
          <div className="hero-copy">
            <p>{copy.heroSub}</p>
            <h1>{copy.heroTitle}</h1>
            <div className="home-actions">
              <button className="primary-btn" type="button" onClick={() => go("category")}>
                <Megaphone size={18} />
                {copy.raiseComplaint}
              </button>
              <button className="secondary-btn track-btn" type="button" onClick={() => go("tickets")}>
                <FileText size={17} />
                {copy.trackStatus}
              </button>
            </div>
          </div>
          <div className="portrait-slot">
            {assetPolicy.portrait.src ? (
              <img src={assetPolicy.portrait.src} alt={assetPolicy.portrait.label} />
            ) : (
              <div className="portrait-fallback" aria-label={assetPolicy.portrait.label}>
                <strong>{assetPolicy.portrait.fallbackLabel}</strong>
                <span>Review</span>
              </div>
            )}
          </div>
        </div>
        <div className="home-status-row">
          <p className="asset-disclaimer">{assetPolicy.disclaimer.text}</p>
          <div className={`live-api-pill ${categoryConfigSyncState}`}>
            <RadioTower size={14} />
            <span>
              {categoryConfigSyncState === "synced"
                ? copy.liveApiConnected
                : categoryConfigSyncState === "loading"
                  ? copy.liveApiConnecting
                  : copy.liveApiOffline}
            </span>
          </div>
        </div>

        <div className="trust-strip">
          <TrustItem icon={LockKeyhole} label={copy.identity} />
          <TrustItem icon={Phone} label={copy.otp} />
          <TrustItem icon={Clock3} label={copy.sla} />
          <TrustItem icon={Landmark} label={copy.accountable} />
        </div>

        <SectionTitle>{copy.quickCategories}</SectionTitle>
        {categoryConfigSyncState === "offline" && <p className="availability-notice">{copy.categoryConfigOffline}</p>}
        <div className="quick-category-grid">
          {categories.slice(0, 9).map((item) => {
            const availability = categoryAvailability[item.id];
            const selectable = isCategorySelectable(availability);
            return (
              <button
                aria-label={`${item.label[language]}, ${categoryStatusLabel(availability, copy)}`}
                className={[
                  "quick-cat",
                  item.id === "corruption" ? "protected" : "",
                  availability.intakeStatus === "protected_pilot" ? "protected-pilot" : "",
                  !selectable ? "unavailable" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                key={item.id}
                onClick={() => chooseCategory(item.id)}
                type="button"
              >
                <item.icon size={23} />
                <span>{item.label[language]}</span>
                {availability.intakeStatus !== "open" && <CategoryStatusBadge availability={availability} copy={copy} compact />}
              </button>
            );
          })}
        </div>

        <button className="shortcut-card" type="button" onClick={() => go("tickets")}>
          <FileText size={28} />
          <span>
            <strong>{copy.myComplaints}</strong>
            <small>{activeCount} active · {actionCount} needs your response</small>
          </span>
          <ChevronRight size={18} />
        </button>

        <button className="insight-banner" type="button" onClick={() => go("insights")}>
          <BarChart3 size={29} />
          <span>
            <strong>{copy.publicInsights}</strong>
            <small>{tickets.length * 471} complaints this month · 68% resolved</small>
          </span>
          <ChevronRight size={18} />
        </button>
      </div>
      <BottomNav active="home" copy={copy} go={go} />
    </section>
  );
}

function TrustItem({ icon: Icon, label }: { icon: typeof LockKeyhole; label: string }) {
  return (
    <div className="trust-item">
      <Icon size={17} />
      <span>{label}</span>
    </div>
  );
}

function CategoryScreen({
  categoryAvailability,
  categoryConfigSyncState,
  categoryNotice,
  chooseCategory,
  copy,
  go,
  language,
  selectedCategory,
  setLanguage,
}: {
  categoryAvailability: CategoryAvailabilityMap;
  categoryConfigSyncState: "loading" | "synced" | "offline";
  categoryNotice: string | null;
  chooseCategory: (category: CategoryId) => void;
  copy: (typeof t)[Language];
  go: (screen: Screen) => void;
  language: Language;
  selectedCategory: CategoryId | null;
  setLanguage: (language: Language) => void;
}) {
  return (
    <section className="screen active">
      <AppHeader copy={copy} language={language} onBack={() => go("home")} setLanguage={setLanguage} title={copy.chooseCategory} />
      <div className="screen-body">
        <p className="screen-help">{copy.categoryHelp}</p>
        {categoryConfigSyncState === "offline" && <p className="availability-notice">{copy.categoryConfigOffline}</p>}
        {categoryNotice && <p className="availability-notice warn">{categoryNotice}</p>}
        <CategoryGroup categoryAvailability={categoryAvailability} copy={copy} group="protected" language={language} onSelect={chooseCategory} selectedCategory={selectedCategory} title={copy.corruptionGroup} />
        <CategoryGroup categoryAvailability={categoryAvailability} copy={copy} group="civic" language={language} onSelect={chooseCategory} selectedCategory={selectedCategory} title={copy.civicGroup} />
        <CategoryGroup categoryAvailability={categoryAvailability} copy={copy} group="social" language={language} onSelect={chooseCategory} selectedCategory={selectedCategory} title={copy.socialGroup} />
      </div>
      <BottomNav active="raise" copy={copy} go={go} />
    </section>
  );
}

function CategoryGroup({
  categoryAvailability,
  copy,
  group,
  language,
  onSelect,
  selectedCategory,
  title,
}: {
  categoryAvailability: CategoryAvailabilityMap;
  copy: (typeof t)[Language];
  group: Category["group"];
  language: Language;
  onSelect: (category: CategoryId) => void;
  selectedCategory: CategoryId | null;
  title: string;
}) {
  return (
    <div className="list-section">
      <SectionTitle>{title}</SectionTitle>
      <div className="dept-list">
        {categories
          .filter((item) => item.group === group)
          .map((item) => {
            const availability = categoryAvailability[item.id];
            const selectable = isCategorySelectable(availability);
            return (
              <button
                aria-label={`${item.label[language]}, ${categoryStatusLabel(availability, copy)}`}
                className={[
                  "dept-card",
                  item.id === "corruption" ? "protected" : "",
                  availability.intakeStatus === "protected_pilot" ? "protected-pilot" : "",
                  selectedCategory === item.id ? "selected" : "",
                  !selectable ? "unavailable" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                key={item.id}
                data-category-id={item.id}
                onClick={() => onSelect(item.id)}
                type="button"
              >
                <item.icon size={24} />
                <span>
                  <strong>{item.label[language]}</strong>
                  <small>{item.description[language]}</small>
                  <small className="category-state-line">{categoryStatusMessage(availability, copy)}</small>
                </span>
                <CategoryStatusBadge availability={availability} copy={copy} />
                {selectable ? <ChevronRight size={17} /> : <LockKeyhole size={17} />}
              </button>
            );
          })}
      </div>
    </div>
  );
}

function CategoryStatusBadge({
  availability,
  compact = false,
  copy,
}: {
  availability: CitizenCategoryAvailability;
  compact?: boolean;
  copy: (typeof t)[Language];
}) {
  return (
    <em className={`category-status-badge ${availability.intakeStatus}${compact ? " compact" : ""}`}>
      {categoryStatusLabel(availability, copy)}
    </em>
  );
}

function DepartmentScreen({
  category,
  copy,
  department,
  go,
  language,
  setDepartment,
}: {
  category: Category;
  copy: (typeof t)[Language];
  department: string;
  go: (screen: Screen) => void;
  language: Language;
  setDepartment: (department: string) => void;
}) {
  return (
    <section className="screen active">
      <AppHeader copy={copy} onBack={() => go("category")} title={copy.selectDepartment} />
      <div className="screen-body">
        <p className="screen-help">{category.label[language]}</p>
        <div className="dept-list">
          {departments[category.id].map((item) => {
            const departmentName = item.name[language];
            const departmentDesc = item.desc[language];
            const selected = department === item.name.en || department === item.name.ta;
            return (
              <button
                className={selected ? "dept-card selected" : "dept-card"}
                key={item.name.en}
                data-department-name={item.name.en}
                onClick={() => {
                  setDepartment(departmentName);
                  window.setTimeout(() => go("details"), 180);
                }}
                type="button"
              >
                <item.icon size={24} />
                <span>
                  <strong>{departmentName}</strong>
                  <small>{departmentDesc}</small>
                </span>
                <ChevronRight size={17} />
              </button>
            );
          })}
        </div>
        <p className="footnote">{copy.unsure}</p>
      </div>
      <BottomNav active="raise" copy={copy} go={go} />
    </section>
  );
}

function DetailsScreen({
  category,
  copy,
  form,
  go,
  setForm,
}: {
  category: CategoryId;
  copy: (typeof t)[Language];
  form: ComplaintForm;
  go: (screen: Screen) => void;
  setForm: React.Dispatch<React.SetStateAction<ComplaintForm>>;
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const titleValid = form.title.trim().length >= 6;
  const descriptionValid = form.description.trim().length >= 20;
  const canContinue = titleValid && descriptionValid;
  const openEvidencePicker = () => {
    fileInputRef.current?.click();
  };
  const addEvidenceFiles = (files: FileList | null) => {
    if (!files?.length) return;
    setForm((current) => {
      const remainingSlots = Math.max(0, 8 - current.evidence.length);
      const nextFiles = Array.from(files).slice(0, remainingSlots).map(evidenceFileMeta);
      return {
        ...current,
        evidence: [...current.evidence, ...nextFiles],
      };
    });
  };
  const removeEvidence = (indexToRemove: number) => {
    setForm((current) => ({
      ...current,
      evidence: current.evidence.filter((_item, index) => index !== indexToRemove),
    }));
  };

  return (
    <section className="screen active">
      <AppHeader copy={copy} onBack={() => go("department")} title={copy.detailsTitle} />
      {category === "corruption" && (
        <div className="corruption-shield">
          <ShieldAlert size={30} />
          <span>
            <strong>{copy.protected}</strong>
            <small>Corruption complaints go to vigilance screening before local visibility.</small>
          </span>
        </div>
      )}
      <StepProgress current={2} />
      <div className="screen-body">
        <div className="form-section">
          <TextField
            label={copy.titleLabel}
            helper={copy.titleMinHint}
            max={100}
            value={form.title}
            onChange={(title) => setForm((current) => ({ ...current, title }))}
            placeholder={copy.titlePlaceholder}
          />
          <TextArea
            label={copy.descLabel}
            helper={copy.descMinHint}
            max={500}
            value={form.description}
            onChange={(description) => setForm((current) => ({ ...current, description }))}
            placeholder={copy.descPlaceholder}
          />
          <div>
            <label className="field-label">{copy.evidenceLabel}</label>
            <input
              ref={fileInputRef}
              className="visually-hidden"
              type="file"
              accept="image/jpeg,image/png,image/webp,image/heic,image/heif,video/mp4,video/quicktime,application/pdf,text/plain"
              multiple
              onChange={(event) => {
                addEvidenceFiles(event.currentTarget.files);
                event.currentTarget.value = "";
              }}
            />
            <button className="upload-box" type="button" onClick={openEvidencePicker}>
              <Camera size={34} />
              <span>
                <strong>{copy.evidenceCta}</strong>
                <small>{copy.evidenceHelp}</small>
              </span>
            </button>
            {form.evidence.length > 0 && (
              <div className="evidence-list">
                {form.evidence.map((item, index) => (
                  <span className="evidence-pill" key={`${item.fileName}-${item.sizeBytes}-${index}`}>
                    <Upload size={13} />
                    {item.fileName}
                    <small>{Math.max(1, Math.round(item.sizeBytes / 1024))} KB</small>
                    <button aria-label={`Remove ${item.fileName}`} type="button" onClick={() => removeEvidence(index)}>x</button>
                  </span>
                ))}
              </div>
            )}
          </div>
          <TextField label={copy.referenceLabel} value={form.reference} onChange={(reference) => setForm((current) => ({ ...current, reference }))} placeholder={copy.referencePlaceholder} />
          {category === "corruption" && (
            <>
              <TextField label={copy.amountLabel} value={form.amount} onChange={(amount) => setForm((current) => ({ ...current, amount }))} placeholder="Rs." />
              <TextField label={copy.officerLabel} value={form.officer} onChange={(officer) => setForm((current) => ({ ...current, officer }))} placeholder="Name or designation if known" />
            </>
          )}
          <PrivacyNote>{copy.privacyNote}</PrivacyNote>
          {!canContinue && <FormHint>{copy.detailsRequiredHint}</FormHint>}
        </div>
        <div className="full-btn-row">
          <button className="submit-btn" disabled={!canContinue} type="button" onClick={() => canContinue && go("location")}>
            {copy.continueLocation}
            <ChevronRight size={18} />
          </button>
        </div>
      </div>
      <BottomNav active="raise" copy={copy} go={go} />
    </section>
  );
}

function LocationScreen({
  copy,
  form,
  go,
  onContinue,
  phoneOtpRequired,
  setForm,
}: {
  copy: (typeof t)[Language];
  form: ComplaintForm;
  go: (screen: Screen) => void;
  onContinue: () => void;
  phoneOtpRequired: boolean;
  setForm: React.Dispatch<React.SetStateAction<ComplaintForm>>;
}) {
  const canContinue = form.district.trim().length > 1 && form.area.trim().length > 2 && (form.gps || form.issueLocation.trim().length > 5);
  return (
    <section className="screen active">
      <AppHeader copy={copy} onBack={() => go("details")} title={copy.locationTitle} />
      <StepProgress current={3} />
      <div className="screen-body">
        <div className="form-section">
          <label className="field-label">{copy.issueLocation}</label>
          <div className="loc-options">
            <button
              className={form.gps ? "loc-btn active" : "loc-btn"}
              type="button"
              onClick={() =>
                setForm((current) => ({
                  ...current,
                  gps: true,
                  ...demoGpsLocation,
                }))
              }
            >
              <LocateFixed size={22} />
              {copy.useGps}
            </button>
            <button
              className={!form.gps ? "loc-btn active" : "loc-btn"}
              type="button"
              onClick={() =>
                setForm((current) => ({
                  ...current,
                  gps: false,
                  issueLocation: current.issueLocation === demoGpsLocation.issueLocation ? "" : current.issueLocation,
                  district: current.district === demoGpsLocation.district ? "" : current.district,
                  area: current.area === demoGpsLocation.area ? "" : current.area,
                }))
              }
            >
              <MapPin size={22} />
              {copy.manual}
            </button>
          </div>
          {form.gps ? (
            <div className="gps-result">
              <strong>{copy.locationDetected}</strong>
              <span>{form.issueLocation}</span>
            </div>
          ) : (
            <TextField
              label={copy.issueLocation}
              value={form.issueLocation}
              onChange={(issueLocation) => setForm((current) => ({ ...current, issueLocation }))}
              placeholder={copy.manualLocationHint}
            />
          )}
          <label className="field-label" htmlFor="district-select">
            {copy.district}
          </label>
          <select
            id="district-select"
            value={form.district}
            onChange={(event) => setForm((current) => ({ ...current, district: event.target.value }))}
          >
            <option value="">{copy.selectDistrict}</option>
            {tamilNaduDistricts.map((district) => (
              <option key={district} value={district}>
                {district}
              </option>
            ))}
          </select>
          <TextField label={copy.area} value={form.area} onChange={(area) => setForm((current) => ({ ...current, area }))} />
          <TextField label={copy.landmark} value={form.landmark} onChange={(landmark) => setForm((current) => ({ ...current, landmark }))} placeholder={copy.landmarkPlaceholder} />
          <PrivacyNote>{copy.locationPrivacy}</PrivacyNote>
          {!canContinue && <FormHint>{form.gps ? copy.locationRequiredGps : copy.locationRequiredManual}</FormHint>}
        </div>
        <div className="full-btn-row">
          <button className="submit-btn" disabled={!canContinue} type="button" onClick={() => canContinue && onContinue()}>
            {phoneOtpRequired ? copy.continueVerification : copy.reviewSubmit}
            <ChevronRight size={18} />
          </button>
        </div>
      </div>
      <BottomNav active="raise" copy={copy} go={go} />
    </section>
  );
}

function OtpScreen({
  copy,
  form,
  go,
  onPhoneChanged,
  onSendOtp,
  onVerifyOtp,
  otpState,
  setForm,
}: {
  copy: (typeof t)[Language];
  form: ComplaintForm;
  go: (screen: Screen) => void;
  onPhoneChanged: () => void;
  onSendOtp: () => void | Promise<void>;
  onVerifyOtp: () => void | Promise<void>;
  otpState: OtpState;
  setForm: React.Dispatch<React.SetStateAction<ComplaintForm>>;
}) {
  const phoneValid = form.phone.replace(/\D/g, "").length >= 10;
  const otpValid = form.otp.replace(/\D/g, "").length === 6;
  const canSend = phoneValid && otpState.status !== "sending";
  const canVerify = phoneValid && otpValid && !!otpState.challengeId && otpState.status !== "verifying";
  const setOtpDigit = (index: number, value: string) => {
    const digit = value.replace(/\D/g, "").slice(-1);
    setForm((current) => {
      const digits = current.otp.padEnd(6, " ").slice(0, 6).split("");
      digits[index] = digit;
      return { ...current, otp: digits.join("").replace(/\s/g, "") };
    });
  };

  return (
    <section className="screen active">
      <AppHeader copy={copy} onBack={() => go("location")} title={copy.verifyPhone} />
      <StepProgress current={4} />
      <div className="screen-body centered">
        <Phone className="otp-icon" size={54} />
        <h2>{copy.enterOtp}</h2>
        <p>{copy.otpBody}</p>
        <input
          className="phone-input"
          inputMode="tel"
          value={form.phone}
          onChange={(event) => {
            onPhoneChanged();
            setForm((current) => ({ ...current, phone: event.target.value, otp: "" }));
          }}
        />
        <button className="secondary-btn narrow" disabled={!canSend} type="button" onClick={onSendOtp}>
          {otpState.status === "sending" ? "Sending..." : otpState.status === "sent" || otpState.status === "verified" ? "Resend code" : "Send verification code"}
        </button>
        {otpState.mockOtp && (
          <span className="form-hint inline">Local UAT code: {otpState.mockOtp}</span>
        )}
        <div className="otp-boxes" aria-label="Verification code">
          {Array.from({ length: 6 }).map((_, index) => (
            <input
              aria-label={`OTP digit ${index + 1}`}
              className="otp-box"
              inputMode="numeric"
              key={index}
              maxLength={1}
              onChange={(event) => setOtpDigit(index, event.target.value)}
              value={form.otp[index] ?? ""}
            />
          ))}
        </div>
        <span className={otpState.status === "verified" ? "success-text" : "form-hint inline"}>
          {otpState.message ?? "Send OTP, then enter the 6 digit code."}
        </span>
        <button className="submit-btn narrow" disabled={!canVerify} type="button" onClick={onVerifyOtp}>
          {otpState.status === "verifying" ? "Verifying..." : copy.verifyReview}
          <ChevronRight size={18} />
        </button>
      </div>
      <BottomNav active="raise" copy={copy} go={go} />
    </section>
  );
}

function ReviewScreen({
  category,
  copy,
  department,
  form,
  go,
  isSubmitting,
  language,
  phoneOtpRequired,
  submissionError,
  submitComplaint,
}: {
  category: Category;
  copy: (typeof t)[Language];
  department: string;
  form: ComplaintForm;
  go: (screen: Screen) => void;
  isSubmitting: boolean;
  language: Language;
  phoneOtpRequired: boolean;
  submissionError: string | null;
  submitComplaint: () => void | Promise<void>;
}) {
  return (
    <section className="screen active">
      <AppHeader copy={copy} onBack={() => go(phoneOtpRequired ? "otp" : "location")} title={copy.reviewSubmit} />
      <div className="screen-body">
        <p className="screen-help">{copy.reviewHelp}</p>
        <ReviewCard title={copy.reviewCategoryDepartment} rows={[[copy.reviewCategoryLabel, category.label[language]], [copy.reviewDepartmentLabel, department]]} />
        <ReviewCard title={copy.reviewComplaintLabel} rows={[[copy.reviewTitleLabel, form.title], [copy.reviewDescriptionLabel, form.description], [copy.reviewEvidenceLabel, `${form.evidence.length} ${copy.photoVideoItems}`]]} />
        <ReviewCard title={copy.reviewLocationLabel} rows={[[copy.reviewAreaLabel, form.area], [copy.reviewDistrictLabel, form.district], [copy.reviewLandmarkLabel, form.landmark || copy.reviewNotProvided]]} />
        <ReviewCard title={copy.reviewVerificationPrivacy} rows={[[copy.reviewPhoneLabel, phoneOtpRequired ? copy.otpVerified : copy.accountVerified], [copy.reviewIdentityLabel, copy.protected], [copy.reviewFirstSlaLabel, copy.reviewVerificationSla]]} />
        <div className="what-next">
          <Clock3 size={18} />
          <span>
            <strong>{copy.whatNextTitle}</strong> {copy.whatNextBody}
          </span>
        </div>
        {submissionError && <FormHint>{submissionError}</FormHint>}
        <div className="full-btn-row">
          <button className="submit-btn" disabled={isSubmitting} type="button" onClick={submitComplaint}>
            <Send size={18} />
            {isSubmitting ? copy.submittingComplaint : copy.submitComplaint}
          </button>
          <button className="secondary-btn" type="button" onClick={() => go("details")}>
            {copy.editDetails}
          </button>
        </div>
      </div>
      <BottomNav active="raise" copy={copy} go={go} />
    </section>
  );
}

function ConfirmationScreen({ copy, go, latestId }: { copy: (typeof t)[Language]; go: (screen: Screen) => void; latestId: string }) {
  return (
    <section className="screen active">
      <AppHeader copy={copy} title={copy.submitComplaint} />
      <div className="screen-body confirmation">
        <Megaphone size={62} />
        <h2>{copy.confirmationTitle}</h2>
        <div className="confirm-id">
          <span>{copy.complaintId}</span>
          <strong>{latestId}</strong>
        </div>
        <p>{copy.confirmationBody}</p>
        <div className="expect-card">
          <strong>{copy.whatNext}</strong>
          <span><b>{copy.expectDayOne}</b> {copy.expectDayOneBody}</span>
          <span><b>{copy.expectDayTwo}</b> {copy.expectDayTwoBody}</span>
          <span><b>{copy.expectDayThree}</b> {copy.expectDayThreeBody}</span>
        </div>
        <div className="split-actions">
          <button className="submit-btn" type="button" onClick={() => go("ticketDetail")}>{copy.trackStatus}</button>
          <button className="secondary-btn" type="button" onClick={() => go("home")}>{copy.done}</button>
        </div>
      </div>
      <BottomNav active="raise" copy={copy} go={go} />
    </section>
  );
}

function TicketsScreen({
  citizenPhone,
  copy,
  go,
  lookupOtp,
  lookupOtpState,
  onLookupPhoneChange,
  onLookupOtpChange,
  sendLookupOtp,
  selectedTicketId,
  setSelectedTicketId,
  setTicketFilter,
  syncCitizenTickets,
  ticketFilter,
  ticketListSyncing,
  ticketListSyncState,
  tickets,
  verifyLookupOtp,
}: {
  citizenPhone: string;
  copy: (typeof t)[Language];
  go: (screen: Screen) => void;
  lookupOtp: string;
  lookupOtpState: OtpState;
  onLookupPhoneChange: (phone: string) => void;
  onLookupOtpChange: (otp: string) => void;
  sendLookupOtp: () => Promise<void>;
  selectedTicketId: string;
  setSelectedTicketId: (id: string) => void;
  setTicketFilter: (filter: "all" | "action" | "verification" | "escalated" | "resolved") => void;
  syncCitizenTickets: () => Promise<void>;
  ticketFilter: "all" | "action" | "verification" | "escalated" | "resolved";
  ticketListSyncing: boolean;
  ticketListSyncState: TicketListSyncState;
  tickets: Ticket[];
  verifyLookupOtp: () => Promise<void>;
}) {
  const filtered = filterTickets(tickets, ticketFilter);
  const syncDisplay = syncStateDisplay(ticketListSyncing ? { ...ticketListSyncState, status: "loading" } : ticketListSyncState, copy);
  const SyncIcon = syncDisplay.icon;
  const setFilter = (filter: typeof ticketFilter) => {
    setTicketFilter(filter);
    const first = filterTickets(tickets, filter)[0];
    if (first) setSelectedTicketId(first.id);
  };
  return (
    <section className="screen active">
      <AppHeader copy={copy} onBack={() => go("home")} title={copy.myComplaints} />
      <div className="filter-tabs">
        <FilterChip active={ticketFilter === "all"} label={`${copy.filterAll} (${tickets.length})`} onClick={() => setFilter("all")} />
        <FilterChip active={ticketFilter === "action"} label={copy.actionNeeded} onClick={() => setFilter("action")} />
        <FilterChip active={ticketFilter === "verification"} label={copy.verification} onClick={() => setFilter("verification")} />
        <FilterChip active={ticketFilter === "escalated"} label={copy.escalated} onClick={() => setFilter("escalated")} />
        <FilterChip active={ticketFilter === "resolved"} label={copy.resolved} onClick={() => setFilter("resolved")} />
      </div>
      <div className="screen-body ticket-list">
        <div className="ticket-lookup-card">
          <div className="lookup-heading">
            <span>
              <strong>{copy.ticketLookupTitle}</strong>
              <small>{copy.ticketLookupHelp}</small>
            </span>
            {lookupOtpState.status === "verified" ? <span className="verified-pill">{copy.verified}</span> : null}
          </div>
          <div className="lookup-phone-row">
            <label>
              <span>{copy.ticketLookupPhone}</span>
              <input
                inputMode="tel"
                onChange={(event) => onLookupPhoneChange(event.target.value)}
                type="tel"
                value={citizenPhone}
              />
            </label>
            <button className="secondary-btn mini" disabled={lookupOtpState.status === "sending"} type="button" onClick={() => void sendLookupOtp()}>
              <Phone size={14} />
              {copy.sendOtp}
            </button>
          </div>
          {lookupOtpState.status !== "idle" ? (
            <div className="lookup-otp-row">
              <input
                aria-label={copy.enterOtp}
                inputMode="numeric"
                maxLength={6}
                onChange={(event) => onLookupOtpChange(event.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder={copy.enterOtp}
                value={lookupOtp}
              />
              <button
                className="submit-btn mini"
                disabled={lookupOtpState.status === "verifying" || lookupOtp.length < 6}
                type="button"
                onClick={() => void verifyLookupOtp()}
              >
                {lookupOtpState.status === "verifying" ? "..." : copy.verifyOtpShort}
              </button>
            </div>
          ) : null}
          {lookupOtpState.message ? <div className={`lookup-message ${lookupOtpState.status}`}>{lookupOtpState.message}</div> : null}
          <button className="secondary-btn full mini" disabled={ticketListSyncing} type="button" onClick={() => void syncCitizenTickets()}>
            <RotateCcw size={15} />
            {ticketListSyncing ? copy.syncTicketsLoading : copy.syncTickets}
          </button>
        </div>
        <div className={`sync-state-card ${syncDisplay.tone}`}>
          <SyncIcon size={17} />
          <span>
            <strong>{syncDisplay.title}</strong>
            <small>{syncDisplay.body}</small>
          </span>
        </div>
        {filtered.map((ticket) => (
          <button
            className={`ticket-item ${ticket.state} ${selectedTicketId === ticket.id ? "active" : ""}`}
            key={ticket.id}
            onClick={() => {
              setSelectedTicketId(ticket.id);
              go("ticketDetail");
            }}
            type="button"
          >
            <div className="ticket-top">
              <span>
                <small>{ticket.id}</small>
                <strong>{ticket.title}</strong>
              </span>
              <SlaBadge state={ticket.slaState}>{ticket.stageChip}</SlaBadge>
            </div>
            <div className="ticket-meta">
              <span>{categoryName(ticket.category)} · {ticket.stageLabel}</span>
              <time>{ticket.created}</time>
            </div>
            {ticket.actionRequest && <div className="inline-warning">{ticket.actionRequest.title}</div>}
          </button>
        ))}
      </div>
      <BottomNav active="tickets" copy={copy} go={go} />
    </section>
  );
}

function TicketDetailScreen({
  copy,
  go,
  refreshTicket,
  syncNotice,
  syncingTicketId,
  ticket,
}: {
  copy: (typeof t)[Language];
  go: (screen: Screen) => void;
  refreshTicket: (ticketId?: string) => Promise<void>;
  syncNotice: string | null;
  syncingTicketId: string | null;
  ticket: Ticket;
}) {
  const isSyncing = syncingTicketId === ticket.id;
  const brief = ticketDetailBrief(ticket);
  const BriefIcon = brief.icon;
  return (
    <section className="screen active">
      <div className="ticket-detail-header">
        <button className="back-btn" type="button" onClick={() => go("tickets")}>
          <ArrowLeft size={18} />
          {copy.myComplaints}
        </button>
        <small>{ticket.id} · {categoryName(ticket.category)}</small>
        <h1>{ticket.title}</h1>
        <div className="chip-row">
          <span className={`stage-chip ${ticket.state}`}>{ticket.stageLabel}</span>
          <SlaBadge state={ticket.slaState}>{ticket.stageChip}</SlaBadge>
        </div>
      </div>
      <div className="screen-body">
        <div className={`detail-brief-card ${brief.tone}`}>
          <div className="detail-brief-head">
            <div className="detail-brief-icon"><BriefIcon size={19} /></div>
            <span>
              <small>Current owner</small>
              <strong>{brief.ownerLabel}</strong>
              <em>{brief.ownerNote}</em>
            </span>
          </div>
          <div className="detail-brief-grid">
            <div>
              <small>SLA clock</small>
              <strong>{brief.slaNote}</strong>
              <em>{brief.slaTitle}</em>
            </div>
            <div>
              <small>Citizen action</small>
              <strong>{brief.citizenActionTitle}</strong>
              <em>{brief.citizenActionBody}</em>
            </div>
          </div>
          <div className="escalation-path" aria-label="Escalation path">
            {brief.escalationPath.map((step, index) => (
              <span className={index === 0 ? "active" : ""} key={`${ticket.id}-${step}`}>{step}</span>
            ))}
          </div>
        </div>
        {ticket.actionRequest && (
          <div className="info-request-card action-card">
            <strong>{ticket.actionRequest.title}</strong>
            <p>{ticket.actionRequest.body}</p>
            <button className="submit-btn compact" type="button" onClick={() => go("addInfo")}>
              <Upload size={16} />
              {copy.addMoreInfo}
            </button>
          </div>
        )}
        {ticket.rejection && (
          <div className="rejected-card">
            <strong>Rejected, under CM review</strong>
            <p>{ticket.rejection.reason} {ticket.rejection.review}</p>
          </div>
        )}
        {ticket.state === "resolved" && (
          <div className="resolution-review-card">
            <div>
              <strong>{copy.reopenResolved}</strong>
              <p>{copy.disputeHelp}</p>
            </div>
            <button className="submit-btn compact" type="button" onClick={() => go("reopenDispute")}>
              <RotateCcw size={16} />
              {copy.reopenResolved}
            </button>
          </div>
        )}
        {ticket.spineBacked && (
          <div className={`spine-sync-card ${ticket.spineSyncState ?? "synced"}`}>
            <div>
              <strong>MVP spine status</strong>
              <span>
                {ticket.spineSyncState === "offline"
                  ? "Showing last saved copy"
                  : ticket.spineSyncState === "notFound"
                    ? "Ticket not found in the live system"
                    : `Synced ${ticket.spineSyncedAt ? relativeTime(ticket.spineSyncedAt) : "just now"}`}
              </span>
            </div>
            <button className="secondary-btn mini" disabled={isSyncing} type="button" onClick={() => void refreshTicket(ticket.id)}>
              <RotateCcw size={15} />
              {isSyncing ? "Syncing" : "Refresh"}
            </button>
          </div>
        )}
        {syncNotice && ticket.spineBacked && <div className="sync-notice">{syncNotice}</div>}
        <div className="case-card">
          <strong>Complaint Snapshot</strong>
          <span>{ticket.description}</span>
          <dl>
            <div><dt>Location</dt><dd>{ticket.location}</dd></div>
            <div><dt>Department</dt><dd>{ticket.department ?? "Assigned during verification"}</dd></div>
            <div><dt>Evidence</dt><dd>{ticket.evidenceCount ?? 0} item(s)</dd></div>
            {ticket.reference && <div><dt>Reference</dt><dd>{ticket.reference}</dd></div>}
          </dl>
        </div>
        <div className="sla-meter">
          <div>
            <strong>{ticket.slaLabel}</strong>
            <span className={ticket.slaState === "breached" ? "overdue" : ""}>{ticket.slaRemaining}</span>
          </div>
          <div className="meter-bg"><i style={{ width: `${ticket.slaProgress}%` }} /></div>
          <small>Ticket age: {ticket.age} · {ticket.escalations} escalation(s)</small>
        </div>
        <div className="queue-section">
          <SectionTitle>{copy.queueResponsibility}</SectionTitle>
          <div className="queue-badges">
            <span className="queue-badge primary">Primary: {ticket.primaryQueue}</span>
            {ticket.secondaryQueues.map((queue) => <span className="queue-badge secondary" key={queue}>Secondary: {queue}</span>)}
          </div>
        </div>
        <SectionTitle>{copy.complaintTimeline}</SectionTitle>
        <Timeline events={ticket.timeline} />
        <SectionTitle>{copy.notificationHistory}</SectionTitle>
        <div className="notif-list">
          {ticket.notificationHistory.map((item) => (
            <div className="notif-item" key={item}>
              <Phone size={18} />
              <span>{item}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function ReopenDisputeScreen({
  copy,
  go,
  submitReopenDispute,
  ticket,
}: {
  copy: (typeof t)[Language];
  go: (screen: Screen) => void;
  submitReopenDispute: (payload: ReopenDisputePayload) => Promise<string | null>;
  ticket: Ticket;
}) {
  const [reason, setReason] = useState("");
  const [evidenceCount, setEvidenceCount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const canSubmit = reason.trim().length >= 20;
  const submit = async () => {
    if (!canSubmit || busy) return;
    setSubmitError(null);
    setBusy(true);
    const errorMessage = await submitReopenDispute({ reason, evidenceCount });
    setBusy(false);
    if (errorMessage) setSubmitError(errorMessage);
  };

  return (
    <section className="screen active">
      <AppHeader copy={copy} onBack={() => go("ticketDetail")} title={copy.disputeResolution} />
      <div className="screen-body">
        <div className="resolution-review-card intro">
          <RotateCcw size={26} />
          <span>
            <strong>{ticket.id}</strong>
            <p>{copy.disputeHelp}</p>
          </span>
        </div>
        <div className="case-card">
          <strong>Resolved complaint snapshot</strong>
          <span>{ticket.title}</span>
          <dl>
            <div><dt>Location</dt><dd>{ticket.location}</dd></div>
            <div><dt>Closure status</dt><dd>{ticket.slaRemaining}</dd></div>
          </dl>
        </div>
        <div className="form-section">
          <TextArea label={copy.disputeReason} max={700} onChange={setReason} placeholder="Explain what is still pending, incorrect, unsafe, or incomplete." value={reason} />
          <div>
            <label className="field-label">{copy.disputeEvidence}</label>
            <button className="upload-box" type="button" onClick={() => setEvidenceCount((count) => count + 1)}>
              <Camera size={32} />
              <span><strong>Add current photo/video</strong><small>Optional, but helps verify the dispute faster</small></span>
            </button>
            {evidenceCount > 0 && <div className="upload-preview">{evidenceCount} current evidence item(s)</div>}
          </div>
          <PrivacyNote>Submitting a dispute returns the ticket to verification, keeps the previous owner visible, and adds CM Cell oversight for closure quality.</PrivacyNote>
          {!canSubmit && <FormHint>Add at least 20 characters explaining why the closure is not acceptable.</FormHint>}
          {submitError && <FormHint>{submitError}</FormHint>}
        </div>
        <div className="full-btn-row">
          <button className="submit-btn" disabled={!canSubmit || busy} type="button" onClick={submit}>
            <RotateCcw size={18} />
            {busy ? "Sending..." : copy.submitDispute}
          </button>
          <button className="secondary-btn" type="button" onClick={() => go("ticketDetail")}>{copy.tickets}</button>
        </div>
      </div>
    </section>
  );
}

function AddInfoScreen({ copy, go, resubmitInfo, ticket }: { copy: (typeof t)[Language]; go: (screen: Screen) => void; resubmitInfo: (payload: AddInfoPayload) => Promise<string | null>; ticket: Ticket }) {
  const request = ticket.actionRequest;
  const [details, setDetails] = useState("");
  const [address, setAddress] = useState("");
  const [evidenceCount, setEvidenceCount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const canResubmit = details.trim().length >= 12 && address.trim().length >= 6;
  const submit = async () => {
    if (!canResubmit || busy) return;
    setSubmitError(null);
    setBusy(true);
    const errorMessage = await resubmitInfo({ address, details, evidenceCount });
    setBusy(false);
    if (errorMessage) setSubmitError(errorMessage);
  };

  return (
    <section className="screen active">
      <AppHeader copy={copy} onBack={() => go("tickets")} title={copy.addMoreInfo} />
      <div className="screen-body">
        <div className="info-request-card">
          <strong>{request?.title ?? copy.actionNeeded}</strong>
          <p>{request?.body}</p>
          {request?.missing.map((item) => <span key={item}>{item}</span>)}
        </div>
        <p className="screen-help">Original submission history is preserved. Your resubmission returns the ticket to verification.</p>
        <div className="form-section">
          <TextArea label="Updated Description" max={500} onChange={setDetails} placeholder="Add missing details here." value={details} />
          <div>
            <label className="field-label">Add Photos / Videos</label>
            <button className="upload-box" type="button" onClick={() => setEvidenceCount((count) => count + 1)}>
              <Upload size={32} />
              <span><strong>Add evidence photos</strong><small>Will help verification team</small></span>
            </button>
            {evidenceCount > 0 && <div className="upload-preview">{evidenceCount} new evidence item(s)</div>}
          </div>
          <TextField label="Exact Address / Ward" onChange={setAddress} placeholder="House/flat number, street, ward" value={address} />
          {!canResubmit && <FormHint>Updated details and exact address are required to resubmit.</FormHint>}
          {submitError && <FormHint>{submitError}</FormHint>}
        </div>
        <div className="full-btn-row">
          <button className="submit-btn" disabled={!canResubmit || busy} type="button" onClick={submit}>
            <RotateCcw size={18} />
            {busy ? "Submitting..." : copy.resubmit}
          </button>
          <button className="secondary-btn" type="button" onClick={() => go("tickets")}>{copy.tickets}</button>
        </div>
      </div>
    </section>
  );
}

function InsightsScreen({ copy, go, tickets }: { copy: (typeof t)[Language]; go: (screen: Screen) => void; tickets: Ticket[] }) {
  const [insightTab, setInsightTab] = useState<"trends" | "open">("trends");
  const newCitizenTickets = Math.max(0, tickets.length - seedTickets.length);
  const categoryStats: Array<[string, number]> = [
    ["Roads", 824 + tickets.filter((ticket) => ticket.category === "roads").length],
    ["Water", 512 + tickets.filter((ticket) => ticket.category === "water").length],
    ["Power", 438 + tickets.filter((ticket) => ticket.category === "power").length],
    ["Sanitation", 361 + tickets.filter((ticket) => ticket.category === "sanitation").length],
    ["Public Safety", 246 + tickets.filter((ticket) => ticket.category === "safety").length],
    ["Corruption", 126 + tickets.filter((ticket) => ticket.category === "corruption").length],
  ];
  const categoryMax = Math.max(...categoryStats.map(([, count]) => count), 1);
  const totalThisMonth = 2847 + newCitizenTickets;
  const allTimeTotal = 128485 + newCitizenTickets;
  const trendBreaches = 312 + tickets.filter((ticket) => ticket.slaState === "breached").length;
  const openDepartmentStats: Array<[string, number]> = [
    ["Municipal Roads", 4820 + tickets.filter((ticket) => ticket.category === "roads" && ticket.state !== "resolved").length],
    ["Water Supply", 3940 + tickets.filter((ticket) => ticket.category === "water" && ticket.state !== "resolved").length],
    ["TANGEDCO / Power", 2780 + tickets.filter((ticket) => ticket.category === "power" && ticket.state !== "resolved").length],
    ["Sanitation", 2120 + tickets.filter((ticket) => ticket.category === "sanitation" && ticket.state !== "resolved").length],
    ["Revenue", 1450 + tickets.filter((ticket) => ticket.category === "revenue" && ticket.state !== "resolved").length],
    ["CM Cell / Vigilance", 420 + tickets.filter((ticket) => ["corruption", "ration"].includes(ticket.category) && ticket.state !== "resolved").length],
  ];
  const openCityStats: Array<[string, number]> = [
    ["Chennai", 5860 + tickets.filter((ticket) => cityName(ticket.location) === "Chennai" && ticket.state !== "resolved").length],
    ["Coimbatore", 2380],
    ["Madurai", 1840],
    ["Tiruchirappalli", 1260],
    ["Salem", 940],
    ["Tirunelveli", 720],
  ];
  const openNow = openDepartmentStats.reduce((sum, [, count]) => sum + count, 0);
  const openBreached = 2148 + tickets.filter((ticket) => ticket.slaState === "breached" && ticket.state !== "resolved").length;
  const trends = [
    { label: "Complaints", month: totalThisMonth.toLocaleString("en-IN"), allTime: allTimeTotal.toLocaleString("en-IN"), note: "+8% vs Apr" },
    { label: "Resolved", month: "1,936", allTime: "92,640", note: "68% closure rate" },
    { label: "Avg. close time", month: "4.2d", allTime: "5.8d", note: "improving" },
    { label: "SLA breaches", month: String(trendBreaches), allTime: "18,420", note: "needs attention" },
  ];

  return (
    <section className="screen active">
      <AppHeader copy={copy} onBack={() => go("home")} title={copy.publicInsights} />
      <div className="insights-hero">
        <strong>Tamil Nadu · May 2026</strong>
        <span>{copy.aggregateOnly}</span>
      </div>
      <div className="screen-body">
        <div className="insight-tabs" role="tablist" aria-label="Insights sections">
          <button className={insightTab === "trends" ? "active" : ""} type="button" onClick={() => setInsightTab("trends")}>Trends</button>
          <button className={insightTab === "open" ? "active" : ""} type="button" onClick={() => setInsightTab("open")}>Open Issues</button>
        </div>

        {insightTab === "trends" && (
          <>
            <SectionTitle>Trends</SectionTitle>
            <div className="trend-table">
              <div className="trend-head">
                <span>Metric</span>
                <span>Month</span>
                <span>All-time</span>
              </div>
              {trends.map((row) => (
                <div className="trend-row" key={row.label}>
                  <span>
                    <strong>{row.label}</strong>
                    <small>{row.note}</small>
                  </span>
                  <b>{row.month}</b>
                  <b>{row.allTime}</b>
                </div>
              ))}
            </div>

            <div className="insight-card">
              <strong>Issue mix this month</strong>
              <span>Aggregated by complaint category.</span>
            </div>
            <div className="bar-chart">
              {categoryStats.map(([name, count]) => (
                <div className="bar-row" key={name}>
                  <span>{name}</span>
                  <div><i style={{ width: `${Math.max(12, (count / categoryMax) * 100)}%` }}>{count.toLocaleString("en-IN")}</i></div>
                </div>
              ))}
            </div>
          </>
        )}

        {insightTab === "open" && (
          <>
            <SectionTitle>Open Issues</SectionTitle>
            <div className="open-summary">
              <StatCard label="Open now" value={openNow.toLocaleString("en-IN")} />
              <StatCard label="SLA breached" value={openBreached.toLocaleString("en-IN")} />
            </div>
            <InsightCountList title="By Department" rows={openDepartmentStats} />
            <InsightCountList title="By City" rows={openCityStats} />
          </>
        )}

        <PrivacyNotice />
      </div>
      <BottomNav active="insights" copy={copy} go={go} />
    </section>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="section-title">{children}</h2>;
}

function StepProgress({ current }: { current: number }) {
  return (
    <div className="step-progress" aria-label="Progress">
      {[0, 1, 2, 3, 4].map((step) => (
        <div className="step-wrap" key={step}>
          <span className={step < current ? "step-dot done" : step === current ? "step-dot current" : "step-dot"} />
          {step < 4 && <i className={step < current ? "done" : ""} />}
        </div>
      ))}
    </div>
  );
}

function TextField({
  helper,
  label,
  max,
  onChange,
  placeholder,
  value,
}: {
  helper?: string;
  label: string;
  max?: number;
  onChange: (value: string) => void;
  placeholder?: string;
  value: string;
}) {
  return (
    <label>
      <span className="field-label">{label}</span>
      {helper && <small className="field-help">{helper}</small>}
      <input maxLength={max} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} value={value} />
      {max && <small className="char-count">{value.length} / {max}</small>}
    </label>
  );
}

function TextArea({
  helper,
  label,
  max,
  onChange,
  placeholder,
  value,
}: {
  helper?: string;
  label: string;
  max?: number;
  onChange: (value: string) => void;
  placeholder?: string;
  value: string;
}) {
  return (
    <label>
      <span className="field-label">{label}</span>
      {helper && <small className="field-help">{helper}</small>}
      <textarea maxLength={max} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} value={value} />
      {max && <small className="char-count">{value.length} / {max}</small>}
    </label>
  );
}

function PrivacyNote({ children }: { children: React.ReactNode }) {
  return (
    <div className="privacy-note">
      <LockKeyhole size={18} />
      <span>{children}</span>
    </div>
  );
}

function FormHint({ children }: { children: React.ReactNode }) {
  return (
    <div className="form-hint">
      <AlertTriangle size={15} />
      <span>{children}</span>
    </div>
  );
}

function ReviewCard({ rows, title }: { rows: Array<[string, string]>; title: string }) {
  return (
    <div className="review-card">
      <h3>{title}</h3>
      {rows.map(([key, value]) => (
        <div className="review-row" key={key}>
          <span>{key}</span>
          <strong>{value}</strong>
        </div>
      ))}
    </div>
  );
}

function SlaBadge({ children, state }: { children: React.ReactNode; state: SlaState }) {
  return <span className={`sla-badge ${state}`}>{children}</span>;
}

function FilterChip({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return <button className={active ? "filter-tab active" : "filter-tab"} onClick={onClick} type="button">{label}</button>;
}

function Timeline({ events }: { events: TimelineEvent[] }) {
  return (
    <div className="timeline">
      {events.map((event) => (
        <div className="timeline-item" key={`${event.label}-${event.time}`}>
          <span className={`timeline-dot ${event.tone ?? "neutral"}`}>
            <event.icon size={16} />
          </span>
          <div>
            <strong>{event.label}</strong>
            <time>{event.time}</time>
            {event.note && <p>{event.note}</p>}
          </div>
        </div>
      ))}
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat-card">
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function InsightCountList({ rows, title }: { rows: Array<[string, number]>; title: string }) {
  const max = Math.max(...rows.map(([, count]) => count), 1);
  return (
    <div className="count-list">
      <h3>{title}</h3>
      {rows.slice(0, 6).map(([name, count]) => (
        <div className="count-row" key={name}>
          <span>{name}</span>
          <div><i style={{ width: `${Math.max(12, (count / max) * 100)}%` }} /></div>
          <b>{count.toLocaleString("en-IN")}</b>
        </div>
      ))}
    </div>
  );
}

function PrivacyNotice() {
  return (
    <div className="privacy-dark">
      <strong>Privacy Notice</strong>
      <span>All data shown here is aggregate only. No names, phone numbers, addresses, or complaint content is displayed publicly.</span>
    </div>
  );
}

function filterTickets(tickets: Ticket[], filter: "all" | "action" | "verification" | "escalated" | "resolved") {
  return tickets.filter((ticket) => {
    if (filter === "action") return ticket.state === "awaiting";
    if (filter === "verification") return ticket.state === "verification";
    if (filter === "escalated") return ticket.state === "ministry" || ticket.state === "cmCell";
    if (filter === "resolved") return ticket.state === "resolved";
    return true;
  });
}

function categoryName(categoryId: CategoryId) {
  return categories.find((category) => category.id === categoryId)?.label.en ?? categoryId;
}

function publicDepartmentName(ticket: Ticket) {
  if (ticket.department) return ticket.department;
  if (ticket.state === "awaiting") return "Citizen Updates";
  if (ticket.state === "cmCell" || ticket.state === "rejectedReview") return "CM Cell / Review";
  if (ticket.primaryQueue.includes("Verification")) return "Verification Team";
  return ticket.primaryQueue;
}

function cityName(location: string) {
  const parts = location.split(",").map((part) => part.trim()).filter(Boolean);
  return parts.at(-1) ?? location;
}

function countBy<T>(items: T[], getName: (item: T) => string) {
  const map = new Map<string, number>();
  items.forEach((item) => {
    const name = getName(item);
    map.set(name, (map.get(name) ?? 0) + 1);
  });
  return [...map.entries()].sort((a, b) => b[1] - a[1]);
}

export default App;
