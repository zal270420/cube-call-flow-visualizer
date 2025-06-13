import React, { useState, useEffect } from "react"; // Import useEffect

// Simplified CUBE Configuration Data (aligned with your latest 'show run' and new strategy)
const cubeConfig = {
  uriClasses: {
    ZOOM: ["144.195.121.212", "206.247.121.212"],
    CUCM: ["192.168.210.21", "10.99.99.3"], // Added 10.99.99.3 for CUCM redundancy
    ITSP: ["192.168.130.5"],
  },
  e164PatternMaps: {
    101: /^301\d{3}$/, // Matches 301 followed by any 3 digits for CUCM internal
    201: /^101\d{3}$/, // Matches 101 followed by any 3 digits for Zoom internal
    110: /^\+1[2-9]\d{2}[2-9]\d{6}$/, // Standard NA 10-digit E.164 (e.g., +14085551234)
    210: /^\+1[2-9]\d{2}[2-9]\d{6}$/, // Kept as distinct pattern for now, but behavior matches 110
    301: /^\+1620555\d{4}$/, // Matches +1620555XXXX for Zoom DIDs
    302: /^\+13035553\d{3}$/, // Matches +13035553XXX for CUCM DIDs
  },
  translationRules: {
    105: { type: "calling", pattern: /\+16205558080/, replace: "108080" }, // Specific Zoom DID to internal for CUCM
    210: { type: "calling", pattern: /301001/, replace: "+13035553001" }, // CUCM internal to +E.164
    301: { type: "called", pattern: /^\+1620555(\d{4})$/, replace: "101$1" }, // PSTN DID to Zoom internal
    302: { type: "called", pattern: /^\+13035553(\d{3})$/, replace: "301$1" }, // PSTN DID to CUCM internal
  },
  translationProfiles: {
    IN_PSTN_TO_CUCM: { target: "called", rule: "302" },
    IN_PSTN_TO_ZOOM: { target: "called", rule: "301" },
    OUT_CUCM_TO_PSTN: { target: "calling", rule: "210" },
    OUT_ZOOM_TO_CUCM_CPN: { target: "calling", rule: "105" },
  },
  dialPeers: [
    {
      id: 1000,
      description: "IN_ZOOM_TO_CUBE (Primary ingress from Zoom)",
      type: "inbound",
      incomingUriVia: "ZOOM",
      sipTenant: 100,
      oksProfile: 100,
      rtpSrtp: true,
      transportTls: true,
    },
    {
      id: 1010,
      description: "OUT_ZOOM_TO_CUCM (Zoom 101XXX to CUCM 301XXX internal)",
      type: "outbound",
      destinationE164PatternMap: "101",
      sipTenant: 200,
      oksProfile: 200,
      translationProfiles: [
        { type: "outgoing", profile: "OUT_ZOOM_TO_CUCM_CPN" },
      ],
    },
    {
      id: 1100,
      description: "OUT_ZOOM_TO_ITSP (Zoom to PSTN - CPN Passthrough)",
      type: "outbound",
      destinationE164PatternMap: "110",
      sipTenant: 300,
      oksProfile: 300,
    },
    {
      id: 2000,
      description: "IN_CUCM_TO_CUBE (Primary ingress from CUCM)",
      type: "inbound",
      incomingUriVia: "CUCM",
      sipTenant: 200,
      oksProfile: 200,
    },
    {
      id: 2010,
      description: "OUT_CUCM_TO_ZOOM (CUCM 301XXX to Zoom 101XXX internal)",
      type: "outbound",
      destinationE164PatternMap: "201",
      sipTenant: 100,
      oksProfile: 100,
      rtpSrtp: true,
      transportTls: true,
    },
    {
      id: 2100,
      description: "OUT_CUCM_TO_ITSP (CUCM 301XXX to PSTN)",
      type: "outbound",
      destinationE164PatternMap: "110",
      sipTenant: 300,
      oksProfile: 300,
      translationProfiles: [{ type: "outgoing", profile: "OUT_CUCM_TO_PSTN" }],
    },
    {
      id: 3000,
      description: "IN_ITSP_TO_CUBE (Primary ingress from ITSP)",
      type: "inbound",
      incomingUriVia: "ITSP",
      sipTenant: 300,
      oksProfile: 300,
    },
    {
      id: 3010,
      description: "IN_ITSP_TO_ZOOM (PSTN DID to Zoom 101XXX)",
      type: "outbound",
      incomingCalledNumberMatch: /^\+1620555\d{4}$/,
      sipTenant: 100,
      oksProfile: 100,
      rtpSrtp: true,
      transportTls: true,
      translationProfiles: [{ type: "outgoing", profile: "IN_PSTN_TO_ZOOM" }],
    },
    {
      id: 3020,
      description: "IN_ITSP_TO_CUCM (PSTN DID to CUCM 301XXX)",
      type: "outbound",
      incomingCalledNumberMatch: /^\+13035553\d{3}$/,
      sipTenant: 200,
      oksProfile: 200,
      translationProfiles: [{ type: "outgoing", profile: "IN_PSTN_TO_CUCM" }],
    },
  ],
};

// Calling Plan Testing Matrix Data
const callingPlanMatrixData = [
  {
    id: 1,
    callingPlatform: "Zoom Phone",
    calledPlatform: "CUCM",
    callingNumber: "101001",
    calledNumber: "301001",
    description: "Internal call from Zoom to CUCM extension.",
    cubePath: "IN_ZOOM_TO_CUBE (1000) ➡️ OUT_ZOOM_TO_CUCM (1010)",
    status: "Success",
  },
  {
    id: 2,
    callingPlatform: "CUCM",
    calledPlatform: "Zoom Phone",
    callingNumber: "301001",
    calledNumber: "101001",
    description: "Internal call from CUCM to Zoom extension.",
    cubePath: "IN_CUCM_TO_CUBE (2000) ➡️ OUT_CUCM_TO_ZOOM (2010)",
    status: "Success",
  },
  {
    id: 3,
    callingPlatform: "Zoom Phone",
    calledPlatform: "PSTN",
    callingNumber: "+16205558080",
    calledNumber: "+1234567890",
    description:
      "Outbound call from Zoom to Public Switched Telephone Network (PSTN). CPN passed through.",
    cubePath: "IN_ZOOM_TO_CUBE (1000) ➡️ OUT_ZOOM_TO_ITSP (1100)",
    status: "Success",
  },
  {
    id: 4,
    callingPlatform: "PSTN (ITSP)",
    calledPlatform: "Zoom Phone",
    callingNumber: "+1234567890",
    calledNumber: "+16205558080",
    description: "Inbound call from PSTN to Zoom. DID translated.",
    cubePath: "IN_ITSP_TO_CUBE (3000) ➡️ IN_ITSP_TO_ZOOM (3010)",
    status: "Success",
  },
  {
    id: 5,
    callingPlatform: "CUCM",
    calledPlatform: "PSTN",
    callingNumber: "301001",
    calledNumber: "+1234567890",
    description: "Outbound call from CUCM to PSTN. CPN translated.",
    cubePath: "IN_CUCM_TO_CUBE (2000) ➡️ OUT_CUCM_TO_ITSP (2100)",
    status: "Success",
  },
  {
    id: 6,
    callingPlatform: "PSTN (ITSP)",
    calledPlatform: "CUCM",
    callingNumber: "+1234567890",
    calledNumber: "+13035553001",
    description: "Inbound call from PSTN to CUCM. DID translated.",
    cubePath: "IN_ITSP_TO_CUBE (3000) ➡️ IN_ITSP_TO_CUCM (3020)",
    status: "Success",
  },
];

function applyTranslation(number, ruleId) {
  const rule = cubeConfig.translationRules[ruleId];
  if (!rule) {
    return number;
  }
  const regex = rule.pattern;
  return number.replace(regex, rule.replace);
}

function App() {
  const [cpn, setCpn] = useState("");
  const [cdpn, setCdpn] = useState("");
  const [originatingSystem, setOriginatingSystem] = useState("Zoom Phone");
  const [callFlow, setCallFlow] = useState([]);
  const [errorMessage, setErrorMessage] = useState("");
  const [visualFlowData, setVisualFlowData] = useState(null);

  // Set default input values based on the initial originatingSystem
  useEffect(() => {
    if (originatingSystem === "Zoom Phone") {
      setCpn("+16205558080"); // Zoom to PSTN default CPN
      setCdpn("+1234567890"); // Generic PSTN CDPN
    } else if (originatingSystem === "CUCM") {
      setCpn("301001"); // CUCM to Zoom default CPN
      setCdpn("101001"); // Zoom extension CDPN
    } else if (originatingSystem === "PSTN (ITSP)") {
      setCpn("+1234567890"); // Generic PSTN CPN
      setCdpn("+16205558080"); // PSTN to Zoom DID
    }
  }, [originatingSystem]); // Re-run when originatingSystem changes

  const simulateCall = () => {
    setCallFlow([]);
    setErrorMessage("");
    setVisualFlowData(null);

    let currentCpn = cpn;
    let currentCdpn = cdpn;
    const flowSteps = [];

    let currentVisualFlowData = {
      callingPlatformName: originatingSystem,
      calledPlatformName: "Unknown",
      initialCallingNumber: cpn,
      initialCalledNumber: cdpn,
      inboundDp: null,
      outboundDp: null,
      cpnTranslated: null,
      cdpnTranslated: null,
      finalCallingNumber: null,
      finalCalledNumber: null,
      error: null,
      warning: null,
    };

    flowSteps.push({
      type: "start",
      message: `Call initiated: CPN: ${cpn} 📞, CDPN: ${cdpn} ☎️`,
    });

    // --- Step 1: Identify Ingress Dial-Peer ---
    let ingressDp = null;
    const possibleIngressDps = cubeConfig.dialPeers.filter(
      (dp) => dp.type === "inbound"
    );

    for (const dp of possibleIngressDps) {
      if (dp.incomingUriVia === "ZOOM" && originatingSystem === "Zoom Phone") {
        ingressDp = dp;
        break;
      }
      if (dp.incomingUriVia === "CUCM" && originatingSystem === "CUCM") {
        ingressDp = dp;
        break;
      }
      if (dp.incomingUriVia === "ITSP" && originatingSystem === "PSTN (ITSP)") {
        ingressDp = dp;
        break;
      }
    }

    if (!ingressDp) {
      const msg =
        "🚫 No matching Ingress Dial-Peer found for the originating system. Check originating system selection.";
      setErrorMessage(msg);
      currentVisualFlowData.error = msg;
      flowSteps.push({ type: "error", message: msg });
      setVisualFlowData(currentVisualFlowData);
      return;
    }

    currentVisualFlowData.inboundDp = {
      id: ingressDp.id,
      description: ingressDp.description,
      cpn: currentCpn,
      cdpn: currentCdpn,
      transportTls: ingressDp.transportTls,
      rtpSrtp: ingressDp.rtpSrtp,
    };
    flowSteps.push({
      type: "inbound",
      message: `⬇️ Inbound DP: ${ingressDp.id} (${ingressDp.description})`,
    });

    // --- Step 2: Identify Outbound Dial-Peer ---
    let outboundDp = null;
    const possibleOutboundDps = cubeConfig.dialPeers.filter(
      (dp) => dp.type === "outbound"
    );

    if (originatingSystem === "PSTN (ITSP)") {
      const sortedItspDps = possibleOutboundDps
        .filter(
          (dp) =>
            dp.incomingCalledNumberMatch &&
            dp.incomingCalledNumberMatch.test(currentCdpn)
        )
        .sort(
          (a, b) =>
            b.incomingCalledNumberMatch.source.length -
            a.incomingCalledNumberMatch.source.length
        );
      outboundDp = sortedItspDps[0];
      if (sortedItspDps.length > 1) {
        const warnMsg = `⚠️ Multiple inbound/outbound DPs matched for PSTN (ITSP) incoming. Selected ${outboundDp.id}.`;
        flowSteps.push({ type: "warning", message: warnMsg });
        currentVisualFlowData.warning = warnMsg;
      }
    } else {
      const sortedOutboundDps = possibleOutboundDps
        .filter(
          (dp) =>
            dp.destinationE164PatternMap &&
            cubeConfig.e164PatternMaps[dp.destinationE164PatternMap] &&
            cubeConfig.e164PatternMaps[dp.destinationE164PatternMap].test(
              currentCdpn
            )
        )
        .sort(
          (a, b) =>
            cubeConfig.e164PatternMaps[b.destinationE164PatternMap].source
              .length -
            cubeConfig.e164PatternMaps[a.destinationE164PatternMap].source
              .length
        );

      if (originatingSystem === "Zoom Phone") {
        outboundDp =
          sortedOutboundDps.find((dp) => dp.id === 1100) ||
          sortedOutboundDps[0];
      } else if (originatingSystem === "CUCM") {
        outboundDp =
          sortedOutboundDps.find((dp) => dp.id === 2100) ||
          sortedOutboundDps[0];
      } else {
        outboundDp = sortedOutboundDps[0];
      }

      if (sortedOutboundDps.length > 1) {
        const warnMsg = `⚠️ Multiple outbound DPs matched for ${originatingSystem} outgoing. Selected ${outboundDp.id}.`;
        flowSteps.push({ type: "warning", message: warnMsg });
        currentVisualFlowData.warning = warnMsg;
      }
    }

    if (!outboundDp) {
      const msg =
        "🚫 No matching Outbound Dial-Peer found for the Called Number after ingress processing. Check CDPN and routing patterns.";
      setErrorMessage(msg);
      currentVisualFlowData.error = msg;
      flowSteps.push({ type: "error", message: msg });
      setVisualFlowData(currentVisualFlowData);
      return;
    }

    if (outboundDp.description.includes("CUCM"))
      currentVisualFlowData.calledPlatformName = "CUCM";
    else if (outboundDp.description.includes("Zoom"))
      currentVisualFlowData.calledPlatformName = "Zoom Phone";
    else if (
      outboundDp.description.includes("ITSP") ||
      outboundDp.destinationE164PatternMap === "110" ||
      outboundDp.destinationE164PatternMap === "210"
    )
      currentVisualFlowData.calledPlatformName = "PSTN";

    // --- Step 3: Apply Translations (Incoming and Outgoing on Outbound DP) ---
    let cpnTranslatedRecord = null;
    let cdpnTranslatedRecord = null;

    let cpnAtEgress = currentCpn; // Track CPN after translations
    let cdpnAtEgress = currentCdpn; // Track CDPN after translations

    if (outboundDp.translationProfiles) {
      for (const tp of outboundDp.translationProfiles) {
        const profile = cubeConfig.translationProfiles[tp.profile];
        if (profile) {
          const rule = cubeConfig.translationRules[profile.rule];
          if (rule) {
            let oldNum = "";
            let newNum = "";
            let targetType = profile.target;

            if (targetType === "called") {
              oldNum = cdpnAtEgress;
              newNum = applyTranslation(cdpnAtEgress, profile.rule);
              if (oldNum !== newNum) {
                cdpnAtEgress = newNum;
                cdpnTranslatedRecord = {
                  original: oldNum,
                  translated: newNum,
                  profile: tp.profile,
                };
                flowSteps.push({
                  type: "translation_cdpn",
                  message: `🔄 CDPN Translated (${tp.type} leg) by "${tp.profile}" (rule ${profile.rule}). Old: ${oldNum} ➡️ New: ${newNum}`,
                });
              } else {
                flowSteps.push({
                  type: "info",
                  message: `ℹ️ No CDPN translation by "${tp.profile}" (${tp.type} leg).`,
                });
              }
            } else if (targetType === "calling") {
              oldNum = cpnAtEgress;
              newNum = applyTranslation(cpnAtEgress, profile.rule);
              if (oldNum !== newNum) {
                cpnAtEgress = newNum;
                cpnTranslatedRecord = {
                  original: oldNum,
                  translated: newNum,
                  profile: tp.profile,
                };
                flowSteps.push({
                  type: "translation_cpn",
                  message: `🔄 CPN Translated (${tp.type} leg) by "${tp.profile}" (rule ${profile.rule}). Old: ${oldNum} ➡️ New: ${newNum}`,
                });
              } else {
                flowSteps.push({
                  type: "info",
                  message: `ℹ️ No CPN translation by "${tp.profile}" (${tp.type} leg).`,
                });
              }
            }
          }
        }
      }
    }

    currentVisualFlowData.cpnTranslated = cpnTranslatedRecord;
    currentVisualFlowData.cdpnTranslated = cdpnTranslatedRecord;

    currentVisualFlowData.outboundDp = {
      id: outboundDp.id,
      description: outboundDp.description,
      cpn: cpnAtEgress,
      cdpn: cdpnAtEgress,
      transportTls: outboundDp.transportTls,
      rtpSrtp: outboundDp.rtpSrtp,
    };
    flowSteps.push({
      type: "outbound",
      message: `⬆️ Outbound DP: ${outboundDp.id} (${outboundDp.description})`,
    });

    flowSteps.push({
      type: "final",
      message: `🏁 Final Call State: CPN: ${cpnAtEgress} 📞, CDPN: ${cdpnAtEgress} ☎️`,
    });

    currentVisualFlowData.finalCallingNumber = cpnAtEgress;
    currentVisualFlowData.finalCalledNumber = cdpnAtEgress;

    setCallFlow(flowSteps);
    setVisualFlowData(currentVisualFlowData);
  };

  return (
    <div className="min-h-screen bg-gray-100 p-4 sm:p-6 lg:p-8 font-sans antialiased text-gray-800">
      {/* Tailwind CSS CDN and Font Link - typically in index.html for React apps */}
      {/* <script src="https://cdn.tailwindcss.com"></script> */}
      {/* <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap" rel="stylesheet" /> */}

      <style>
        {`
        body { font-family: 'Inter', sans-serif; }
        .flow-box {
            padding: 0.75rem 1.25rem;
            border-radius: 0.5rem;
            border: 1px solid;
            text-align: center;
            min-width: 200px;
            max-width: 280px;
            box-shadow: 0 1px 3px rgba(0,0,0,0.1);
            transition: all 0.3s ease-in-out;
            flex-shrink: 0;
        }
        .flow-arrow {
            font-size: 1.5rem;
            color: #60a5fa; /* blue-400 */
            margin: auto 0.5rem; /* Center vertically, add horizontal margin */
            text-align: center;
            flex-shrink: 0;
        }
        /* Consistency with React version */
        button {
            min-height: 44px; /* Recommended minimum touch target size */
            min-width: 44px;
        }
        input[type="text"] {
            min-height: 44px; /* Ensure input fields are also large enough */
        }
        table {
            border-collapse: collapse;
        }
        th, td {
            border: 1px solid #e2e8f0;
        }
        .header-title {
            text-align: center;
            font-size: 2.25rem;
            font-weight: 700;
            color: #1f2937;
            margin-bottom: 1.5rem;
        }
        .header-description {
            text-align: center;
            color: #4b5563;
            margin-bottom: 1.5rem;
        }
        .input-group {
            margin-bottom: 1.5rem;
        }
        .label {
            display: block;
            font-size: 0.875rem;
            font-weight: 500;
            color: #374151;
            margin-bottom: 0.5rem;
        }
        .select, .input-text {
            display: block;
            width: 100%;
            padding-left: 0.75rem;
            padding-right: 2.5rem;
            padding-top: 0.5rem;
            padding-bottom: 0.5rem;
            border: 1px solid #d1d5db;
            border-radius: 0.375rem;
            box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.05);
            font-size: 0.875rem;
            color: #1f2937;
            background-color: white;
            transition: all 0.2s ease-in-out;
        }
        .select:focus, .input-text:focus {
            outline: none;
            box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.5);
            border-color: #3b82f6;
        }
        .simulate-button {
            padding: 0.75rem 1.5rem;
            background-color: #2563eb;
            color: white;
            font-weight: 600;
            border-radius: 0.5rem;
            box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
            transition: all 0.2s ease-in-out;
        }
        .simulate-button:hover {
            background-color: #1d4ed8;
        }
        .simulate-button:focus {
            outline: none;
            box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.5), 0 0 0 4px rgba(59, 130, 246, 0.2);
        }
        .main-card {
            background-color: white;
            padding: 2rem;
            border-radius: 0.75rem;
            box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05);
            width: 100%;
            max-width: 4xl;
            margin-bottom: 2rem;
            border: 1px solid #e5e7eb;
        }
        .results-card {
            background-color: white;
            padding: 2rem;
            border-radius: 0.75rem;
            box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05);
            width: 100%;
            max-width: 6xl;
            margin-top: 2rem;
            border: 1px solid #e5e7eb;
        }
        .results-title {
            text-align: center;
            font-size: 1.5rem;
            font-weight: 700;
            color: #1f2937;
            margin-bottom: 1.5rem;
        }
        .error-message {
            background-color: #fee2e2;
            border: 1px solid #ef4444;
            color: #ef4444;
            padding: 1rem;
            border-radius: 0.75rem;
            margin-top: 1rem;
            font-weight: 600;
            text-align: center;
        }
        `}
      </style>

      <div className="max-w-6xl mx-auto bg-white rounded-xl shadow-lg p-6 sm:p-8 border border-gray-200">
        <h1 className="text-3xl sm:text-4xl font-extrabold text-blue-800 mb-6 text-center">
          CUBE Call Flow Simulator 📞
        </h1>

        <div className="mb-8 p-4 bg-blue-50 rounded-lg border border-blue-200">
          <h2 className="text-xl font-semibold text-blue-700 mb-3">
            Guide for Lab Engineers 🧑‍💻
          </h2>
          <p className="text-sm text-gray-700 leading-relaxed mb-3">
            Use this simulator to test call flows based on the "Calling Plan
            Testing Matrix" scenarios below. Enter the "Calling Number" and
            "Called Number" for a specific scenario, then click "Simulate Call
            Flow" to see the CUBE's routing and translation logic in action.
          </p>
          <ul className="list-disc list-inside text-sm text-gray-700 space-y-1">
            <li>
              **Calling Number:** The number originating the call (e.g.,
              `101001`, `301001`, `+16205558080`).
            </li>
            <li>
              **Called Number:** The number being dialed (e.g., `301001`,
              `101001`, `+1234567890`).
            </li>
            <li>
              **Output:** Displays the detected inbound/outbound dial-peers and
              any number translations applied.
            </li>
          </ul>
        </div>

        {/* Calling Plan Testing Matrix Table */}
        <div className="mb-8 p-4 bg-gray-50 rounded-lg border border-gray-200 overflow-x-auto">
          <h2 className="text-xl font-semibold text-gray-800 mb-4">
            Calling Plan Testing Matrix 📋
          </h2>
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-100">
              <tr>
                <th
                  scope="col"
                  className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                >
                  Scenario
                </th>
                <th
                  scope="col"
                  className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                >
                  Calling Party (CPN)
                </th>
                <th
                  scope="col"
                  className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                >
                  Called Party (CDPN)
                </th>
                <th
                  scope="col"
                  className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                >
                  CUBE Ingress DP
                </th>
                <th
                  scope="col"
                  className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                >
                  CUBE Egress DP
                </th>
                <th
                  scope="col"
                  className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                >
                  CPN at CUBE Egress
                </th>
                <th
                  scope="col"
                  className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                >
                  CDPN at CUBE Egress
                </th>
                <th
                  scope="col"
                  className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                >
                  Expected Result
                </th>
                <th
                  scope="col"
                  className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                >
                  Notes on Formatting
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {callingPlanMatrixData.map((scenario) => {
                // Extract Ingress and Egress DP IDs from cubePath string
                const pathParts = scenario.cubePath.match(/\((\d+)\)/g);
                const ingressDp =
                  pathParts && pathParts[0]
                    ? pathParts[0].replace(/[\(\)]/g, "")
                    : "N/A";
                const egressDp =
                  pathParts && pathParts[1]
                    ? pathParts[1].replace(/[\(\)]/g, "")
                    : "N/A";

                return (
                  <tr key={scenario.id}>
                    <td className="px-3 py-2 text-sm text-gray-700">
                      {scenario.id}. {scenario.description}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap text-sm text-gray-700">
                      {scenario.callingNumber}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap text-sm text-gray-700">
                      {scenario.calledNumber}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap text-sm text-gray-700">
                      {ingressDp}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap text-sm text-gray-700">
                      {egressDp}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap text-sm text-gray-700">
                      Simulated by CUBE
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap text-sm text-gray-700">
                      Simulated by CUBE
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap text-sm text-green-600 font-semibold">
                      {scenario.status}
                    </td>
                    <td className="px-3 py-2 text-sm text-gray-700">N/A</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-8">
          {/* Input Section */}
          <div className="bg-gray-50 p-6 rounded-lg shadow-inner border border-gray-200">
            <h3 className="text-xl font-semibold text-gray-800 mb-4">
              Input Call Details 👇
            </h3>
            <div className="space-y-4">
              <div>
                <label
                  htmlFor="originatingSystemInput"
                  className="block text-sm font-medium text-gray-700 mb-2"
                >
                  Originating System 🚀
                </label>
                <select
                  id="originatingSystemInput"
                  className="mt-1 block w-full pl-3 pr-10 py-2 text-base border-gray-300 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm rounded-md shadow-sm"
                  value={originatingSystem}
                  onChange={(e) => {
                    setOriginatingSystem(e.target.value);
                  }}
                >
                  <option value="Zoom Phone">Zoom Phone</option>
                  <option value="CUCM">CUCM</option>
                  <option value="PSTN (ITSP)">PSTN (ITSP)</option>
                </select>
              </div>
              <div>
                <label
                  htmlFor="callingNumberInput"
                  className="block text-sm font-medium text-gray-700 mb-2"
                >
                  Calling Number (CPN) 🗣️
                </label>
                <input
                  type="text"
                  id="callingNumberInput"
                  value={cpn}
                  onChange={(e) => setCpn(e.target.value)}
                  placeholder="e.g., 101001 or +16205558080"
                  className="w-full p-3 border border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 transition duration-150 ease-in-out"
                />
              </div>
              <div>
                <label
                  htmlFor="calledNumberInput"
                  className="block text-sm font-medium text-gray-700 mb-2"
                >
                  Called Number (CDPN) 📞
                </label>
                <input
                  type="text"
                  id="calledNumberInput"
                  value={cdpn}
                  onChange={(e) => setCdpn(e.target.value)}
                  placeholder="e.g., 301001 or +1234567890"
                  className="w-full p-3 border border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 transition duration-150 ease-in-out"
                />
              </div>
            </div>
            <button
              onClick={simulateCall}
              className="mt-6 w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-4 rounded-md shadow-md transition duration-200 ease-in-out transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
            >
              Simulate Call Flow ✨
            </button>
          </div>

          {/* Simulation Results (Visual Flow) */}
          <div className="bg-gray-50 p-6 rounded-lg shadow-inner border border-gray-200">
            <h3 className="text-xl font-semibold text-gray-800 mb-4">
              Call Flow Visualization 🗺️
            </h3>
            {visualFlowData ? (
              <div className="flex flex-row items-start space-x-4 overflow-x-auto p-4">
                {/* Originating Platform */}
                <div className="flow-box bg-blue-200 border-blue-500 flex-shrink-0">
                  <p className="font-semibold text-blue-800">
                    Origin: {visualFlowData.callingPlatformName}
                  </p>
                  <p className="text-sm">
                    CPN: {visualFlowData.initialCallingNumber}
                  </p>
                  <p className="text-sm">
                    CDPN: {visualFlowData.initialCalledNumber}
                  </p>
                </div>

                {/* Incoming Arrow */}
                <div className="flow-arrow flex-shrink-0">➡️ Incoming Call</div>

                {/* CUBE Ingress DP */}
                {visualFlowData.inboundDp && (
                  <div className="flow-box bg-blue-200 border-blue-500 flex-shrink-0">
                    <p className="font-semibold text-blue-800">
                      CUBE Ingress DP: {visualFlowData.inboundDp.id}
                    </p>
                    <p className="text-xs text-gray-700">
                      {visualFlowData.inboundDp.description}
                    </p>
                    <p className="text-sm">
                      CPN: {visualFlowData.inboundDp.cpn}
                    </p>
                    <p className="text-sm">
                      CDPN: {visualFlowData.inboundDp.cdpn}
                    </p>
                    <p className="text-xs text-gray-600">
                      Sec:{" "}
                      {visualFlowData.inboundDp.transportTls
                        ? "TLS"
                        : "Non-Secure"}{" "}
                      / {visualFlowData.inboundDp.rtpSrtp ? "SRTP" : "RTP"}
                    </p>
                  </div>
                )}

                {/* Processing Arrow */}
                <div className="flow-arrow flex-shrink-0">
                  ➡️ CUBE Processing
                </div>

                {/* Translations Box */}
                <div
                  className={`flow-box ${
                    visualFlowData.cpnTranslated ||
                    visualFlowData.cdpnTranslated
                      ? "bg-green-100 border-green-500"
                      : "bg-gray-100 border-gray-300"
                  } flex-shrink-0`}
                >
                  <p className="font-semibold text-gray-800">
                    Translations Applied:
                  </p>
                  {visualFlowData.cpnTranslated ? (
                    <p className="text-sm text-green-700">
                      CPN: {visualFlowData.cpnTranslated.original} ➡️{" "}
                      {visualFlowData.cpnTranslated.translated} (by{" "}
                      {visualFlowData.cpnTranslated.profile})
                    </p>
                  ) : (
                    <p className="text-sm text-gray-600">CPN: No change</p>
                  )}
                  {visualFlowData.cdpnTranslated ? (
                    <p className="text-sm text-green-700">
                      CDPN: {visualFlowData.cdpnTranslated.original} ➡️{" "}
                      {visualFlowData.cdpnTranslated.translated} (by{" "}
                      {visualFlowData.cdpnTranslated.profile})
                    </p>
                  ) : (
                    <p className="text-sm text-gray-600">CDPN: No change</p>
                  )}
                </div>

                {/* Outgoing Arrow */}
                <div className="flow-arrow flex-shrink-0">➡️ Outgoing Call</div>

                {/* CUBE Egress DP */}
                {visualFlowData.outboundDp && (
                  <div className="flow-box bg-blue-200 border-blue-500 flex-shrink-0">
                    <p className="font-semibold text-blue-800">
                      CUBE Egress DP: {visualFlowData.outboundDp.id}
                    </p>
                    <p className="text-xs text-gray-700">
                      {visualFlowData.outboundDp.description}
                    </p>
                    <p className="text-sm">
                      CPN: {visualFlowData.outboundDp.cpn}
                    </p>
                    <p className="text-sm">
                      CDPN: {visualFlowData.outboundDp.cdpn}
                    </p>
                    <p className="text-xs text-gray-600">
                      Sec:{" "}
                      {visualFlowData.outboundDp.transportTls
                        ? "TLS"
                        : "Non-Secure"}{" "}
                      / {visualFlowData.outboundDp.rtpSrtp ? "SRTP" : "RTP"}
                    </p>
                  </div>
                )}

                {/* Delivered Arrow */}
                <div className="flow-arrow flex-shrink-0">
                  ✅ Call Delivered
                </div>

                {/* Destination Platform */}
                <div className="flow-box bg-blue-200 border-blue-500 flex-shrink-0">
                  <p className="font-semibold text-blue-800">
                    Destination: {visualFlowData.calledPlatformName}
                  </p>
                  <p className="text-sm">
                    CPN: {visualFlowData.finalCallingNumber}
                  </p>
                  <p className="text-sm">
                    CDPN: {visualFlowData.finalCalledNumber}
                  </p>
                </div>

                {visualFlowData.error && (
                  <div className="flow-box bg-red-100 border-red-500 text-red-700 text-sm font-semibold flex-shrink-0">
                    ❌ Error: {visualFlowData.error}
                  </div>
                )}
                {visualFlowData.warning && (
                  <div className="flow-box bg-yellow-100 border-yellow-500 text-yellow-700 text-sm font-semibold flex-shrink-0">
                    ⚠️ Warning: {visualFlowData.warning}
                  </div>
                )}
              </div>
            ) : (
              <p className="text-center text-gray-500">
                Simulate a call to see the flow graphic.
              </p>
            )}
          </div>
        </div>

        {/* Textual Simulation Results (for more detailed steps) */}
        <div className="mt-8 p-6 bg-gray-50 rounded-lg border border-gray-200 shadow-inner">
          <h2 className="text-xl font-semibold text-gray-800 mb-4">
            Detailed Simulation Steps 📋
          </h2>
          <div className="space-y-3">
            {callFlow.length === 0 ? (
              <p className="text-center text-gray-500">
                No steps to display yet.
              </p>
            ) : (
              callFlow.map((res, index) => (
                <p
                  key={index}
                  className={`text-sm ${
                    res.type === "error"
                      ? "text-red-600 font-semibold"
                      : res.type === "warning"
                      ? "text-yellow-700"
                      : res.type === "inbound" ||
                        res.type === "outbound" ||
                        res.type === "start" ||
                        res.type === "final"
                      ? "text-indigo-700 font-medium"
                      : res.type === "translation_cdpn" ||
                        res.type === "translation_cpn"
                      ? "text-green-700 font-medium"
                      : "text-gray-900"
                  } flex items-center`}
                >
                  {(res.type === "start" && (
                    <span className="mr-2 text-xl">🟢</span>
                  )) ||
                    (res.type === "inbound" && (
                      <span className="mr-2 text-xl">⬇️</span>
                    )) ||
                    (res.type === "translation_cdpn" && (
                      <span className="mr-2 text-xl">↔️</span>
                    )) ||
                    (res.type === "outbound" && (
                      <span className="mr-2 text-xl">⬆️</span>
                    )) ||
                    (res.type === "translation_cpn" && (
                      <span className="mr-2 text-xl">↔️</span>
                    )) ||
                    (res.type === "final" && (
                      <span className="mr-2 text-xl">🏁</span>
                    )) ||
                    (res.type === "error" && (
                      <span className="mr-2 text-xl">❌</span>
                    )) ||
                    (res.type === "warning" && (
                      <span className="mr-2 text-xl">⚠️</span>
                    )) ||
                    (res.type === "info" && (
                      <span className="mr-2 text-xl">ℹ️</span>
                    ))}
                  {res.message}
                </p>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
