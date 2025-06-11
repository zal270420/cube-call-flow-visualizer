import React, { useState, useEffect } from "react";

// Simplified CUBE Configuration Data (based on your 'show run' and previous updates)
// This data drives the simulation logic.
const cubeConfig = {
  uriClasses: {
    ZOOM: ["144.195.121.212", "206.247.121.212"],
    CUCM: ["192.168.210.21", "10.99.99.3"], // Added 10.99.99.3 for CUCM redundancy
    ITSP: ["192.168.130.5"],
  },
  e164PatternMaps: {
    101: /^721...$/, // Matches 721 followed by any 3 digits
    201: /^711...$/, // Matches 711 followed by any 3 digits
    110: /^\+1[2-9][0-9]{2}[2-9][0-9]{6}$/, // Standard NA 10-digit E.164
    210: /^\+1[2-9][0-9]{2}[2-9][0-9]{6}$/, // Standard NA 10-digit E.164
    301: /^\+16205551[0-9]{3}$/, // Matches +16205551XXX
    302: /^(?:\+13035551[0-9]{3}|\+16205552001)$/, // Matches +13035551XXX OR +16205552001
  },
  translationRules: {
    101: { type: "called", pattern: /^1...$/, replace: "72$&" }, // e.g., 1001 -> 721001
    102: { type: "called", pattern: /^72(....)$/, replace: "$1" }, // e.g., 721001 -> 1001
    110: { type: "calling", pattern: /^.*$/, replace: "$&" }, // Pass-through
    201: { type: "called", pattern: /^1...$/, replace: "71$&" }, // e.g., 1001 -> 711001
    202: { type: "called", pattern: /^71(....)$/, replace: "$1" }, // e.g., 711001 -> 1001
    210: { type: "calling", pattern: /^.*$/, replace: "$&" }, // Pass-through
    301: { type: "called", pattern: /^\+1620555(....)$/, replace: "$1" }, // e.g., +16205551001 -> 1001
    302: {
      type: "called",
      pattern: /^\+1(?:303555|620555)(....)$/,
      replace: "$1",
    }, // e.g., +13035551001 -> 1001, +16205552001 -> 2001
  },
  translationProfiles: {
    ZOOM_TO_CUCM_CALLED_ROUTE: { target: "called", rule: "101" },
    IN_PSTN_TO_CUCM: { target: "called", rule: "302" },
    IN_PSTN_TO_ZOOM: { target: "called", rule: "301" },
    // Note: IN_ZOOM_TO_CUCM and OUT_CUCM_TO_ZOOM were defined with translate calling,
    // but were not explicitly applied to specific dial-peers in the provided config's context.
    // For this simulation, we'll only apply translations directly referenced on dial-peers.
    OUT_CUCM_TO_PSTN: { target: "calling", rule: "210" },
    OUT_ZOOM_TO_PSTN: { target: "calling", rule: "110" },
    STRIP_71_TO_ZOOM: { target: "called", rule: "202" },
    STRIP_72_TO_CUCM: { target: "called", rule: "102" },
  },
  dialPeers: [
    {
      id: 1000,
      description: "IN_ZOOM_TO_CUBE",
      type: "inbound",
      incomingUriVia: "ZOOM",
      sipTenant: 100,
      oksProfile: 100,
      rtpSrtp: true,
      transportTls: true,
    },
    {
      id: 1010,
      description: "OUT_ZOOM_TO_CUCM",
      type: "outbound",
      destinationE164PatternMap: "101",
      sipTenant: 100,
      oksProfile: 100,
      translationProfiles: [
        { type: "incoming", profile: "ZOOM_TO_CUCM_CALLED_ROUTE" },
        { type: "outgoing", profile: "STRIP_72_TO_CUCM" },
      ],
    },
    {
      id: 1100,
      description: "OUT_ZOOM_TO_ITSP",
      type: "outbound",
      destinationE164PatternMap: "110",
      sipTenant: 100,
      oksProfile: 100,
      translationProfiles: [{ type: "outgoing", profile: "OUT_ZOOM_TO_PSTN" }],
    },
    {
      id: 2000,
      description: "IN_CUCM_TO_CUBE",
      type: "inbound",
      incomingUriVia: "CUCM",
      sipTenant: 200,
      oksProfile: 200,
    },
    {
      id: 2010,
      description: "OUT_CUCM_TO_ZOOM",
      type: "outbound",
      destinationE164PatternMap: "201",
      sipTenant: 200,
      oksProfile: 200,
      rtpSrtp: true,
      transportTls: true,
      translationProfiles: [
        { type: "incoming", profile: "CUCM_TO_ZOOM_CALLED_ROUTE" },
        { type: "outgoing", profile: "STRIP_71_TO_ZOOM" },
      ],
    },
    {
      id: 2100,
      description: "OUT_CUCM_TO_ITSP",
      type: "outbound",
      destinationE164PatternMap: "210",
      sipTenant: 200,
      oksProfile: 200,
      translationProfiles: [{ type: "outgoing", profile: "OUT_CUCM_TO_PSTN" }],
    },
    {
      id: 3000,
      description: "IN_ITSP_TO_CUBE",
      type: "inbound",
      incomingUriVia: "ITSP",
      sipTenant: 300,
      oksProfile: 300,
    },
    {
      id: 3010,
      description: "IN_ITSP_TO_ZOOM",
      type: "outbound",
      incomingCalledNumber: /^\+16205551.*$/, // +16205551T
      sipTenant: 300,
      oksProfile: 300,
      rtpSrtp: true,
      transportTls: true,
      translationProfiles: [{ type: "outgoing", profile: "IN_PSTN_TO_ZOOM" }],
    },
    {
      id: 3020,
      description: "IN_ITSP_TO_CUCM",
      type: "outbound",
      incomingCalledNumber: /^\+13035551.*$|^\+16205552001$/, // +13035551T or +16205552001
      sipTenant: 300,
      oksProfile: 300,
      translationProfiles: [{ type: "outgoing", profile: "IN_PSTN_TO_CUCM" }],
    },
  ],
};

function applyTranslation(number, ruleId) {
  const rule = cubeConfig.translationRules[ruleId];
  if (!rule) {
    console.warn(`Translation rule ${ruleId} not found.`);
    return number;
  }
  const regex = new RegExp(rule.pattern);
  return number.replace(regex, rule.replace);
}

function App() {
  const [cpn, setCpn] = useState("1001");
  const [cdpn, setCdpn] = useState("1001");
  const [originatingSystem, setOriginatingSystem] = useState("Zoom Phone");
  const [callFlow, setCallFlow] = useState([]);
  const [errorMessage, setErrorMessage] = useState("");

  const simulateCall = () => {
    setCallFlow([]);
    setErrorMessage("");
    let currentCpn = cpn;
    let currentCdpn = cdpn;
    const flow = [];

    // --- Step 1: Identify Ingress Dial-Peer ---
    let ingressDp = null;
    const possibleIngressDps = cubeConfig.dialPeers.filter(
      (dp) => dp.type === "inbound"
    );

    // Prioritize by matching incomingUriVia first
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
      setErrorMessage(
        "🚫 No matching Ingress Dial-Peer found for the originating system."
      );
      return;
    }

    flow.push({
      lane: originatingSystem,
      status: "Call Initiated",
      cpn: cpn,
      cdpn: cdpn,
      details: "Original call attempt",
    });

    flow.push({
      lane: `CUBE Ingress (DP ${ingressDp.id})`,
      status: `Matched: ${ingressDp.description}`,
      dp: ingressDp,
      cpn: currentCpn,
      cdpn: currentCdpn,
      details: `Incoming URI via: ${ingressDp.incomingUriVia}`,
    });

    // --- Step 2: Apply Ingress Translations (if any) ---
    let cpnAfterIngress = currentCpn;
    let cdpnAfterIngress = currentCdpn;

    // Apply translations associated with this ingress DP's outbound path
    // NOTE: This logic needs careful alignment with how you expect inbound DPs to trigger translations.
    // In your config, translation profiles are typically tied to 'outgoing' on a DP.
    // If an INGRESS DP is meant to transform numbers *before* matching an OUTBOUND DP,
    // those translations usually appear as 'translation-profile incoming' on the *next* dial-peer (the outbound one).

    // Let's model the behavior where `translation-profile incoming` on an OUTBOUND DP
    // applies the transformation for the *current* call leg *before* it gets routed outbound.
    // For now, no direct translation on the INGRESS DP itself. We'll rely on the OUTBOUND DP.

    // --- Step 3: Identify Outbound Dial-Peer ---
    let outboundDp = null;
    const possibleOutboundDps = cubeConfig.dialPeers.filter(
      (dp) => dp.type === "outbound"
    );

    // For ITSP inbound calls, the "outbound" DP is matched by `incoming called-number`
    // For internal/outbound calls, the "outbound" DP is matched by `destination e164-pattern-map`
    if (originatingSystem === "PSTN (ITSP)") {
      // Find outbound DP that matches incoming called-number (for ITSP inbound calls)
      const sortedItspDps = possibleOutboundDps
        .filter(
          (dp) =>
            dp.incomingCalledNumber && dp.incomingCalledNumber.test(currentCdpn)
        )
        .sort(
          (a, b) =>
            b.incomingCalledNumber.source.length -
            a.incomingCalledNumber.source.length
        ); // Prioritize more specific regex

      outboundDp = sortedItspDps[0];
    } else {
      // For Zoom/CUCM internal or outbound calls, match destination e164 pattern map
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
        ); // Prioritize more specific regex

      outboundDp = sortedOutboundDps[0];
    }

    if (!outboundDp) {
      setErrorMessage(
        "🚫 No matching Outbound Dial-Peer found for the Called Number."
      );
      return;
    }

    // --- Step 4: Apply Translations on Outbound Dial-Peer ---
    cpnAfterIngress = currentCpn; // Reset CPN for clarity, assume it's still original for ingress
    cdpnAfterIngress = currentCdpn;

    // Apply "incoming" translation profiles from the matched OUTBOUND dial-peer
    // These profiles modify the numbers as they "arrive" at this logical outbound dial-peer.
    if (outboundDp.translationProfiles) {
      outboundDp.translationProfiles.forEach((tp) => {
        if (tp.type === "incoming") {
          const profile = cubeConfig.translationProfiles[tp.profile];
          if (profile) {
            const rule = cubeConfig.translationRules[profile.rule];
            if (rule) {
              if (profile.target === "called") {
                const oldCdpn = cdpnAfterIngress;
                cdpnAfterIngress = applyTranslation(
                  cdpnAfterIngress,
                  profile.rule
                );
                flow.push({
                  lane: `CUBE Processing (DP ${outboundDp.id})`,
                  status: `Incoming Translation: ${tp.profile}`,
                  cpn: cpnAfterIngress,
                  cdpn: oldCdpn,
                  translatedCdpn: cdpnAfterIngress,
                  details: `Applying ${profile.target} rule ${profile.rule}: ${rule.pattern} -> ${rule.replace}`,
                });
              } else if (profile.target === "calling") {
                const oldCpn = cpnAfterIngress;
                cpnAfterIngress = applyTranslation(
                  cpnAfterIngress,
                  profile.rule
                );
                flow.push({
                  lane: `CUBE Processing (DP ${outboundDp.id})`,
                  status: `Incoming Translation: ${tp.profile}`,
                  cpn: oldCpn,
                  translatedCpn: cpnAfterIngress,
                  cdpn: cdpnAfterIngress,
                  details: `Applying ${profile.target} rule ${profile.rule}: ${rule.pattern} -> ${rule.replace}`,
                });
              }
            }
          }
        }
      });
    }

    // Now push the outbound dial-peer selection
    flow.push({
      lane: `CUBE Egress (DP ${outboundDp.id})`,
      status: `Routing to: ${outboundDp.description}`,
      dp: outboundDp,
      cpn: cpnAfterIngress,
      cdpn: cdpnAfterIngress,
      details: `Destination matched via: ${
        outboundDp.destinationE164PatternMap
          ? `e164-pattern-map ${outboundDp.destinationE164PatternMap}`
          : `incoming called-number ${outboundDp.incomingCalledNumber.source}`
      }`,
    });

    // Apply "outgoing" translation profiles from the matched OUTBOUND dial-peer
    let finalCpn = cpnAfterIngress;
    let finalCdpn = cdpnAfterIngress;

    if (outboundDp.translationProfiles) {
      outboundDp.translationProfiles.forEach((tp) => {
        if (tp.type === "outgoing") {
          const profile = cubeConfig.translationProfiles[tp.profile];
          if (profile) {
            const rule = cubeConfig.translationRules[profile.rule];
            if (rule) {
              if (profile.target === "called") {
                const oldCdpn = finalCdpn;
                finalCdpn = applyTranslation(finalCdpn, profile.rule);
                flow.push({
                  lane: `CUBE Processing (DP ${outboundDp.id})`,
                  status: `Outgoing Translation: ${tp.profile}`,
                  cpn: finalCpn,
                  cdpn: oldCdpn,
                  translatedCdpn: finalCdpn,
                  details: `Applying ${profile.target} rule ${profile.rule}: ${rule.pattern} -> ${rule.replace}`,
                });
              } else if (profile.target === "calling") {
                const oldCpn = finalCpn;
                finalCpn = applyTranslation(finalCpn, profile.rule);
                flow.push({
                  lane: `CUBE Processing (DP ${outboundDp.id})`,
                  status: `Outgoing Translation: ${tp.profile}`,
                  cpn: oldCpn,
                  translatedCpn: finalCpn,
                  cdpn: finalCdpn,
                  details: `Applying ${profile.target} rule ${profile.rule}: ${rule.pattern} -> ${rule.replace}`,
                });
              }
            }
          }
        }
      });
    }

    // --- Step 5: Final Destination ---
    let destinationSystem = "";
    if (outboundDp.description.includes("CUCM")) destinationSystem = "CUCM";
    else if (outboundDp.description.includes("Zoom"))
      destinationSystem = "Zoom Phone";
    else if (outboundDp.description.includes("ITSP"))
      destinationSystem = "PSTN (ITSP)";

    flow.push({
      lane: destinationSystem,
      status: "Call Delivered",
      cpn: finalCpn,
      cdpn: finalCdpn,
      details: `Call delivered to ${destinationSystem}`,
    });

    setCallFlow(flow);
  };

  return (
    <div className="min-h-screen bg-gray-100 p-8 flex flex-col items-center">
      <script src="https://cdn.tailwindcss.com"></script>
      <link
        href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap"
        rel="stylesheet"
      />

      <style>
        {`
        body { font-family: 'Inter', sans-serif; }
        .lane-container {
          display: grid;
          grid-template-columns: repeat(5, 1fr); /* 5 lanes */
          gap: 1rem;
          width: 100%;
          overflow-x: auto;
          padding-bottom: 1rem;
        }
        .lane-header {
          font-weight: bold;
          text-align: center;
          padding: 0.5rem;
          background-color: #e0e0e0;
          border-radius: 0.5rem;
          min-width: 200px; /* Ensure lanes have enough width */
        }
        .flow-item {
          background-color: white;
          padding: 1rem;
          border-radius: 0.75rem;
          box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
          border: 1px solid #d1d5db;
          margin-bottom: 0.75rem;
          min-width: 200px;
        }
        .flow-status {
          font-weight: 600;
          color: #3b82f6; /* Blue */
          margin-bottom: 0.5rem;
        }
        .arrow {
          font-size: 2rem;
          text-align: center;
          animation: bounce 1s infinite;
          color: #10b981; /* Green */
        }
        @keyframes bounce {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-10px); }
        }
        .details-box {
          background-color: #f0f9ff; /* Light blue */
          border-left: 4px solid #3b82f6;
          padding: 0.75rem;
          border-radius: 0.5rem;
          font-size: 0.875rem;
          color: #1d4ed8;
          margin-top: 0.5rem;
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

      <div className="bg-white p-8 rounded-xl shadow-lg w-full max-w-4xl mb-8 border border-gray-200">
        <h1 className="text-3xl font-bold text-gray-800 mb-6 text-center">
          📞 CUBE Call Flow Simulator
        </h1>
        <p className="text-gray-600 mb-6 text-center">
          Visualize how calls traverse your Cisco CUBE based on the configured
          dial plan, translations, and security settings.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <div>
            <label
              htmlFor="originatingSystem"
              className="block text-sm font-medium text-gray-700 mb-2"
            >
              Originating System 🚀
            </label>
            <select
              id="originatingSystem"
              className="mt-1 block w-full pl-3 pr-10 py-2 text-base border-gray-300 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm rounded-md shadow-sm"
              value={originatingSystem}
              onChange={(e) => setOriginatingSystem(e.target.value)}
            >
              <option value="Zoom Phone">Zoom Phone</option>
              <option value="CUCM">CUCM</option>
              <option value="PSTN (ITSP)">PSTN (ITSP)</option>
            </select>
          </div>
          <div>
            <label
              htmlFor="cpn"
              className="block text-sm font-medium text-gray-700 mb-2"
            >
              Calling Party Number (CPN) 🗣️
            </label>
            <input
              type="text"
              id="cpn"
              className="mt-1 block w-full pl-3 pr-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
              value={cpn}
              onChange={(e) => setCpn(e.target.value)}
              placeholder="e.g., 1001 or +15551234567"
            />
          </div>
          <div>
            <label
              htmlFor="cdpn"
              className="block text-sm font-medium text-gray-700 mb-2"
            >
              Called Party Number (CDPN) 📞
            </label>
            <input
              type="text"
              id="cdpn"
              className="mt-1 block w-full pl-3 pr-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
              value={cdpn}
              onChange={(e) => setCdpn(e.target.value)}
              placeholder="e.g., 1001 or +16205551001"
            />
          </div>
        </div>

        <div className="flex justify-center">
          <button
            onClick={simulateCall}
            className="px-6 py-3 bg-blue-600 text-white font-semibold rounded-lg shadow-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition duration-200 ease-in-out"
          >
            Simulate Call Flow ✨
          </button>
        </div>
      </div>

      {errorMessage && (
        <div className="error-message w-full max-w-4xl">{errorMessage}</div>
      )}

      {callFlow.length > 0 && !errorMessage && (
        <div className="bg-white p-8 rounded-xl shadow-lg w-full max-w-6xl border border-gray-200 mt-8">
          <h2 className="text-2xl font-bold text-gray-800 mb-6 text-center">
            📊 Call Flow Visualization
          </h2>
          <div className="lane-container">
            <div className="lane-header">Origin</div>
            <div className="lane-header">CUBE Ingress</div>
            <div className="lane-header">CUBE Processing</div>
            <div className="lane-header">CUBE Egress</div>
            <div className="lane-header">Destination</div>

            {callFlow.map((item, index) => (
              <React.Fragment key={index}>
                {/* Lane Cells */}
                {/* Origin Lane */}
                <div className="flex flex-col items-center justify-center p-2">
                  {item.lane === originatingSystem && (
                    <div className="flow-item w-full">
                      <div className="flow-status">{item.status}</div>
                      <p>
                        CPN: <strong>{item.cpn}</strong>
                      </p>
                      <p>
                        CDPN: <strong>{item.cdpn}</strong>
                      </p>
                      <div className="details-box">{item.details}</div>
                    </div>
                  )}
                </div>

                {/* CUBE Ingress Lane */}
                <div className="flex flex-col items-center justify-center p-2">
                  {item.lane.includes("CUBE Ingress") && (
                    <div className="flow-item w-full">
                      <div className="flow-status">{item.status}</div>
                      <p>
                        DP:{" "}
                        <strong>
                          {item.dp.id} ({item.dp.description})
                        </strong>
                      </p>
                      <p>
                        CPN: <strong>{item.cpn}</strong>
                      </p>
                      <p>
                        CDPN: <strong>{item.cdpn}</strong>
                      </p>
                      <p>
                        Security: {item.dp.transportTls ? "TLS" : "Non-Secure"}{" "}
                        / {item.dp.rtpSrtp ? "SRTP" : "RTP"}
                      </p>
                      <div className="details-box">{item.details}</div>
                    </div>
                  )}
                </div>

                {/* CUBE Processing Lane */}
                <div className="flex flex-col items-center justify-center p-2">
                  {item.lane.includes("CUBE Processing") && (
                    <div className="flow-item w-full bg-yellow-50 border-yellow-300">
                      <div className="flow-status">{item.status}</div>
                      <p>
                        CPN: <strong>{item.cpn}</strong>{" "}
                        {item.translatedCpn && `-> ${item.translatedCpn}`}
                      </p>
                      <p>
                        CDPN: <strong>{item.cdpn}</strong>{" "}
                        {item.translatedCdpn && `-> ${item.translatedCdpn}`}
                      </p>
                      <div className="details-box">{item.details}</div>
                    </div>
                  )}
                </div>

                {/* CUBE Egress Lane */}
                <div className="flex flex-col items-center justify-center p-2">
                  {item.lane.includes("CUBE Egress") && (
                    <div className="flow-item w-full">
                      <div className="flow-status">{item.status}</div>
                      <p>
                        DP:{" "}
                        <strong>
                          {item.dp.id} ({item.dp.description})
                        </strong>
                      </p>
                      <p>
                        CPN: <strong>{item.cpn}</strong>
                      </p>
                      <p>
                        CDPN: <strong>{item.cdpn}</strong>
                      </p>
                      <p>
                        Security: {item.dp.transportTls ? "TLS" : "Non-Secure"}{" "}
                        / {item.dp.rtpSrtp ? "SRTP" : "RTP"}
                      </p>
                      <div className="details-box">{item.details}</div>
                    </div>
                  )}
                </div>

                {/* Destination Lane */}
                <div className="flex flex-col items-center justify-center p-2">
                  {item.lane === "Zoom Phone" ||
                    item.lane === "CUCM" ||
                    (item.lane === "PSTN (ITSP)" &&
                      item.lane !== originatingSystem && (
                        <div className="flow-item w-full bg-green-50 border-green-300">
                          <div className="flow-status">{item.status}</div>
                          <p>
                            CPN: <strong>{item.cpn}</strong>
                          </p>
                          <p>
                            CDPN: <strong>{item.cdpn}</strong>
                          </p>
                          <div className="details-box">{item.details}</div>
                        </div>
                      ))}
                </div>

                {/* Arrows/Spacers based on flow */}
                {index < callFlow.length - 1 && (
                  <>
                    {/* Spacer columns */}
                    <div className="col-span-1"></div>
                    <div className="col-span-1"></div>
                    <div className="col-span-1"></div>
                    <div className="col-span-1"></div>
                    <div className="col-span-1"></div>
                  </>
                )}
              </React.Fragment>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
