var matchSchedule = [];
var percentSyncComplete = 0;
var syncIndex = 0;
var nextMatch = null;
const BASE_API_URLS = ['https://statbotics-production.up.railway.app/v3', 'https://api.statbotics.io/v3', 'https://api-statbotics.iterativerefinement.com/v3']
const TBA_API_BASE_URL = 'https://www.thebluealliance.com/api/v3';
const TBA_AUTH_KEY = 'KGSCksKxS2Z5m3DMlj0DaEjzW7hphTOnAkEhAzJj5lBDEiheTNB9Stw2akjIgGDX';
async function getTeamEventKey(teamNumber) {
    var closestKey = null;
    var now = new Date(1776359580000).getTime();
    await fetch(`https://www.thebluealliance.com/api/v3/team/frc${teamNumber}/events`, {
        method: 'GET',
        headers: {
            'X-TBA-Auth-Key': 'KGSCksKxS2Z5m3DMlj0DaEjzW7hphTOnAkEhAzJj5lBDEiheTNB9Stw2akjIgGDX'
        }
    })
        .then(response => response.json())
        .then(data => {
            if (!Array.isArray(data) || data.length === 0) {
                return;
            }
            closestKey = [data[0].key, new Date(data[0].start_date).getTime()];
            for (let i = 1; i < data.length; i++) {
                let eventStartEpoch = new Date(data[i].start_date).getTime();
                if (Math.abs(now - eventStartEpoch) < Math.abs(now - closestKey[1]) && (closestKey[0]).indexOf(data[i].key) == -1) {
                    closestKey = [data[i].key, eventStartEpoch];
                }
            }
        })
        .catch(error => console.log(error));
    return closestKey ? closestKey[0] : null;
}

async function getTeamEventMatchSchedule(teamNumber, eventKey) {
    const year = Number.parseInt(String(eventKey).slice(0, 4), 10);

    for (let i = 0; i < BASE_API_URLS.length; i++) {
        try {
            const response = await fetch(
                `${BASE_API_URLS[i]}/matches?team=${teamNumber}&year=${Number.isFinite(year) ? year : new Date(1776359580000).getFullYear()}&event=${encodeURIComponent(eventKey)}&metric=match_number&ascending=true`,
                { method: 'GET' }
            );

            if (!response.ok) {
                console.warn(`Statbotics endpoint failed (${response.status}) at ${BASE_API_URLS[i]}`);
                continue;
            }

            const data = await response.json();
            if (Array.isArray(data) && data.length > 0) {
                matchSchedule = data;
                return matchSchedule;
            }
        } catch (error) {
            console.warn(`Statbotics fetch failed at ${BASE_API_URLS[i]}`, error);
        }
    }

    // Fallback: load schedule from TBA so UI still has rows when Statbotics is unavailable.
    try {
        const tbaResponse = await fetch(`${TBA_API_BASE_URL}/event/${encodeURIComponent(eventKey)}/matches`, {
            method: 'GET',
            headers: {
                'X-TBA-Auth-Key': TBA_AUTH_KEY
            }
        });

        if (!tbaResponse.ok) {
            console.warn(`TBA fallback failed with status ${tbaResponse.status}`);
            matchSchedule = [];
            return matchSchedule;
        }

        const tbaMatches = await tbaResponse.json();
        if (!Array.isArray(tbaMatches)) {
            matchSchedule = [];
            return matchSchedule;
        }

        const transformed = tbaMatches
            .filter((match) => {
                const red = match?.alliances?.red?.team_keys;
                const blue = match?.alliances?.blue?.team_keys;
                return (Array.isArray(red) && red.includes(`frc${teamNumber}`)) || (Array.isArray(blue) && blue.includes(`frc${teamNumber}`));
            })
            .map((match) => {
                const isCompleted = match?.score_breakdown != null || (typeof match?.winning_alliance === 'string' && match.winning_alliance.length > 0);
                const predictedTime = Number(match?.predicted_time);
                const scheduledTime = Number(match?.time);
                const videoKey = Array.isArray(match?.videos) && match.videos.length > 0 ? match.videos[0]?.key || null : null;

                return {
                    key: match?.key,
                    year: Number.parseInt(String(match?.event_key || eventKey).slice(0, 4), 10),
                    event: match?.event_key || eventKey,
                    week: null,
                    elim: match?.comp_level !== 'qm',
                    comp_level: match?.comp_level,
                    set_number: match?.set_number,
                    match_number: match?.match_number,
                    match_name: match?.key,
                    time: Number.isFinite(scheduledTime) ? scheduledTime : null,
                    predicted_time: Number.isFinite(predictedTime) ? predictedTime : (Number.isFinite(scheduledTime) ? scheduledTime : null),
                    status: isCompleted ? 'Completed' : 'Upcoming',
                    video: videoKey,
                    alliances: match?.alliances || { red: { team_keys: [] }, blue: { team_keys: [] } },
                    pred: null,
                    result: isCompleted ? (match?.score_breakdown || {}) : null
                };
            })
            .sort((a, b) => {
                const timeA = Number(a?.predicted_time);
                const timeB = Number(b?.predicted_time);
                if (Number.isFinite(timeA) && Number.isFinite(timeB) && timeA !== timeB) {
                    return timeA - timeB;
                }
                return Number(a?.match_number || 0) - Number(b?.match_number || 0);
            });

        matchSchedule = transformed;
        return matchSchedule;
    } catch (error) {
        console.warn('TBA fallback fetch failed', error);
        matchSchedule = [];
        return matchSchedule;
    }
}

async function sync(teamNumber, entryHandler, matchesHandler) {
    teamNumber = parseInt(teamNumber.toString().replace(/\s/g, ''), 10);
    percentSyncComplete = 0;
    syncIndex = 0;
    console.log("getting event")
    const eventKey = await getTeamEventKey(teamNumber);
    if (!eventKey) {
        matchSchedule = [];
        nextMatch = null;
        percentSyncComplete = 100;
        return;
    }
    percentSyncComplete = 50;
    console.log("getting schedule")
    await getTeamEventMatchSchedule(teamNumber, eventKey);
    percentSyncComplete = 75;
    console.log("getting team predictions")
    matchSchedule = await populateTeamScores(matchSchedule, eventKey);
    percentSyncComplete = 100;
    console.log("setting next match")
    setNextMatch(matchSchedule);
    if (matchSchedule.length === 0) {
        nextMatch = null;
        percentSyncComplete = 100;
    }

    entryHandler(nextMatch)
    matchesHandler(matchSchedule)
    console.log("set next match")
    console.log("end")


}

function setNextMatch(listMatches) {
    const byTime = setNextMatchViaTime(listMatches);
    if (byTime) {
        nextMatch = byTime;
        return nextMatch;
    }

    const byMatchNumber = setNextMatchViaMatchNumbers(listMatches);
    nextMatch = byMatchNumber;
    return nextMatch;
}

function setNextMatchViaMatchNumbers(listMatches) {
    if (!Array.isArray(listMatches) || listMatches.length === 0) {
        return null;
    }

    let candidate = null;
    for (let i = 0; i < listMatches.length; i++) {
        const match = listMatches[i];
        const isCompleted = match?.score_breakdown != null || match?.result != null || match?.status === 'Completed';
        if (isCompleted) {
            continue;
        }

        if (candidate == null || match.match_number < candidate.match_number) {
            candidate = match;
        }
    }

    return candidate;

}

function setNextMatchViaTime(listMatches) {
    if (!Array.isArray(listMatches) || listMatches.length === 0) {
        nextMatch = null;
        return nextMatch;
    }

    let now = new Date(1776359580000).getTime() / 1000;
    nextMatch = null;
    let closestPositiveDistance = Number.POSITIVE_INFINITY;
    for (let i = 0; i < listMatches.length; i++) {
        const predictedTime = Number(listMatches[i]?.predicted_time);
        if (!Number.isFinite(predictedTime)) {
            continue;
        }
        let distance = predictedTime - now;
        if (distance > 0 && distance < closestPositiveDistance) {
            closestPositiveDistance = distance;
            nextMatch = listMatches[i];
        }
    }

    return nextMatch;
}

function getTeamNumber(teamKey) {
    const teamNumber = Number.parseInt(String(teamKey).replace(/^frc/i, ''), 10);
    return Number.isFinite(teamNumber) ? teamNumber : null;
}

async function getStatboticsJson(path) {
    for (const baseUrl of BASE_API_URLS) {
        try {
            const response = await fetch(`${baseUrl}${path}`, { method: 'GET' });
            if (!response.ok) {
                console.warn(`Statbotics endpoint failed (${response.status}) at ${baseUrl}`);
                continue;
            }

            return await response.json();
        } catch (error) {
            console.warn(`Statbotics fetch failed at ${baseUrl}`, error);
        }
    }

    return null;
}

function toFiniteNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

function formatPercent(value) {
    const number = toFiniteNumber(value);
    if (number == null) {
        return null;
    }

    return `${Math.round((number <= 1 ? number * 100 : number))}%`;
}

function formatTeams(teamKeys) {
    const teams = Array.isArray(teamKeys) ? teamKeys : [];
    return teams
        .map(getTeamNumber)
        .filter((team) => team != null)
        .map((team) => `FRC ${team}`)
        .join(', ') || 'teams pending';
}

function getTeamEpa(teamMatch, metric) {
    const breakdown = teamMatch?.epa?.breakdown;
    const aliases = {
        total_points: ['total_points', 'total'],
        auto_points: ['auto_points', 'auto'],
        teleop_points: ['teleop_points', 'teleop'],
        endgame_points: ['endgame_points', 'endgame'],
        transition_fuel: ['transition_fuel'],
        first_shift_fuel: ['first_shift_fuel'],
        second_shift_fuel: ['second_shift_fuel'],
        total_tower: ['total_tower'],
        endgame_tower: ['endgame_tower']
    };
    const keys = aliases[metric] || [metric];

    for (const key of keys) {
        const value = key === 'total_points'
            ? teamMatch?.epa?.total_points ?? breakdown?.total_points ?? teamMatch?.epa
            : breakdown?.[key] ?? teamMatch?.[`${key}_epa`];
        const numericValue = toFiniteNumber(value);
        if (numericValue != null) {
            return numericValue;
        }
    }

    return null;
}

function getAllianceTeamMatches(match, teamMatches, alliance) {
    const allianceTeams = Array.isArray(match?.alliances?.[alliance]?.team_keys)
        ? match.alliances[alliance].team_keys.map(getTeamNumber).filter((team) => team != null)
        : [];
    const matchesByTeam = new Map(
        (Array.isArray(teamMatches) ? teamMatches : []).map((teamMatch) => [toFiniteNumber(teamMatch?.team), teamMatch])
    );

    return allianceTeams.map((team) => ({
        team,
        teamMatch: matchesByTeam.get(team) || null
    }));
}

function getAllianceEpa(teamMatches, metric) {
    const values = teamMatches
        .map(({ teamMatch }) => getTeamEpa(teamMatch, metric))
        .filter((value) => value != null);

    if (values.length === 0) {
        return null;
    }

    return values.reduce((sum, value) => sum + value, 0);
}

function getComponentLeader(teamMatches, metric) {
    const candidates = teamMatches
        .map(({ team, teamMatch }) => ({ team, value: getTeamEpa(teamMatch, metric) }))
        .filter(({ value }) => value != null);

    if (candidates.length === 0) {
        return null;
    }

    return candidates.reduce((leader, candidate) => candidate.value > leader.value ? candidate : leader);
}

function getComponentRanking(teamMatches, metric) {
    return teamMatches
        .map(({ team, teamMatch }) => ({ team, value: getTeamEpa(teamMatch, metric) }))
        .filter(({ value }) => value != null)
        .sort((a, b) => b.value - a.value);
}

function getClientTeamNumber(clientTeamNumber) {
    const explicitTeam = getTeamNumber(clientTeamNumber);
    if (explicitTeam != null) {
        return explicitTeam;
    }

    // Keeping this browser-only makes the helper usable from Node scripts too.
    try {
        return typeof window !== 'undefined'
            ? getTeamNumber(window.localStorage?.getItem('chronos.teamNumber'))
            : null;
    } catch {
        return null;
    }
}

function getClientAlliance(match, clientTeamNumber) {
    const clientTeam = getClientTeamNumber(clientTeamNumber);
    if (clientTeam == null) {
        return { clientTeam: null, alliance: null };
    }

    for (const alliance of ['red', 'blue']) {
        const teams = Array.isArray(match?.alliances?.[alliance]?.team_keys)
            ? match.alliances[alliance].team_keys.map(getTeamNumber)
            : [];
        if (teams.includes(clientTeam)) {
            return { clientTeam, alliance };
        }
    }

    return { clientTeam, alliance: null };
}

function getRpOpportunities(prediction, alliance) {
    const namedLabels = [
        { key: 'energized_rp', label: 'Energized' },
        { key: 'supercharged_rp', label: 'Supercharged' },
        { key: 'traversal_rp', label: 'Traversal' }
    ];
    const genericLabels = [
        { key: 'rp_1', label: 'bonus RP 1' },
        { key: 'rp_2', label: 'bonus RP 2' },
        { key: 'rp_3', label: 'bonus RP 3' }
    ];
    const read = (labels) => labels
        .map(({ key, label }) => ({ label, probability: toFiniteNumber(prediction?.[`${alliance}_${key}`]) }))
        .filter(({ probability }) => probability != null);

    const named = read(namedLabels);
    return named.length > 0 ? named : read(genericLabels);
}

/**
 * Shape the per-robot projections already attached to a scheduled match into
 * a display-ready, alliance-scoped comparison. EPA is a points contribution,
 * while ranking-point projections remain an alliance-level outlook because
 * they are earned by the alliance, not by one robot.
 */
function getMatchContributionProjection(match) {
    if (!match || typeof match !== 'object') {
        return null;
    }

    const prediction = match.pred || {};
    const buildAlliance = (alliance) => {
        const allianceData = match?.alliances?.[alliance] || {};
        const teamKeys = Array.isArray(allianceData.team_keys) ? allianceData.team_keys : [];
        const predictionsByTeam = new Map(
            (Array.isArray(allianceData.team_predictions) ? allianceData.team_predictions : [])
                .map((teamMatch) => [getTeamNumber(teamMatch?.team), teamMatch])
        );
        const teams = teamKeys
            .map((teamKey) => {
                const team = getTeamNumber(teamKey);
                const teamMatch = predictionsByTeam.get(team) || null;
                return {
                    team,
                    totalPoints: getTeamEpa(teamMatch, 'total_points'),
                    autoPoints: getTeamEpa(teamMatch, 'auto_points'),
                    teleopPoints: getTeamEpa(teamMatch, 'teleop_points'),
                    endgamePoints: getTeamEpa(teamMatch, 'endgame_points')
                };
            })
            .sort((left, right) => (right.totalPoints ?? -Infinity) - (left.totalPoints ?? -Infinity));
        const highestContribution = Math.max(0, ...teams.map(({ totalPoints }) => totalPoints ?? 0));
        const rpOpportunities = getRpOpportunities(prediction, alliance);
        const winProbability = toFiniteNumber(prediction?.[`${alliance}_win_prob`]);

        return {
            alliance,
            teams,
            highestContribution,
            projectedScore: toFiniteNumber(prediction?.[`${alliance}_score`]),
            winProbability,
            rpOpportunities
        };
    };

    return {
        red: buildAlliance('red'),
        blue: buildAlliance('blue')
    };
}

function getRoleRecommendation(clientTeam, ownTeamMatches, opponentTeamMatches, ownTeleopEpa, opponentTeleopEpa, clientWinProbability) {
    const client = ownTeamMatches.find(({ team }) => team === clientTeam);
    const totalRanking = getComponentRanking(ownTeamMatches, 'total_points');
    const teleopRanking = getComponentRanking(ownTeamMatches, 'teleop_points');
    const clientTotal = client ? getTeamEpa(client.teamMatch, 'total_points') : null;
    const clientTeleop = client ? getTeamEpa(client.teamMatch, 'teleop_points') : null;
    const clientAuto = client ? getTeamEpa(client.teamMatch, 'auto_points') : null;
    const clientEndgame = client ? getTeamEpa(client.teamMatch, 'endgame_points') : null;
    const primaryScorer = totalRanking[0];
    const primaryTeleop = teleopRanking[0];
    const opponentThreat = getComponentLeader(opponentTeamMatches, 'teleop_points');

    if (clientTotal == null) {
        return 'Confirm your role with partners before queueing; there is not enough current data to call it for you.';
    }
    if (primaryScorer?.team === clientTeam) {
        return 'You are expected to lead scoring. Keep your lanes clear and let a partner take the first defensive assignment.';
    }
    if (clientAuto != null && clientTeleop != null && clientAuto > clientTeleop * 0.55) {
        return 'Your auto is a big part of the plan. Confirm a clear path, then settle into reliable scoring support.';
    }
    if (clientEndgame != null && clientTeleop != null && clientEndgame > clientTeleop * 0.6) {
        return 'Your endgame matters. Leave scoring early enough to finish it cleanly.';
    }
    if (clientTeleop != null && primaryTeleop && primaryTeleop.team !== clientTeam && clientTeleop >= primaryTeleop.value * 0.55) {
        return `You are the support scorer. Keep cycles moving and clear space for FRC ${primaryTeleop.team}; defend only when it will not cost a score.`;
    }
    if (opponentThreat && ownTeleopEpa != null && opponentTeleopEpa != null && (clientWinProbability == null || clientWinProbability < 0.62)) {
        return `Be the flexible support robot. After auto, short legal pressure on FRC ${opponentThreat.team} can help, but do not give up your endgame.`;
    }
    return 'Be the flexible support robot: take open scoring work, keep lanes open, and stay out of penalty trouble.';
}

/**
 * Produce a short, driver-facing strategy brief for an upcoming match.
 *
 * This deliberately turns Statbotics projections into a few actionable calls,
 * rather than showing drivers a scouting report full of model terminology.
 *
 * @param {string} matchKey Statbotics/TBA match key, e.g. "2026miket_qm12".
 * @param {number|string} [clientTeamNumber] The dashboard team's number. When
 * omitted, the saved Chronos team number is used in a browser context.
 * @returns {Promise<string>} A human-readable pre-match brief.
 */
async function generatePreMatchBrief(matchKey, clientTeamNumber) {
    const normalizedMatchKey = typeof matchKey === 'string' ? matchKey.trim() : '';
    if (!normalizedMatchKey) {
        throw new Error('A non-empty match key is required to generate a pre-match brief.');
    }

    const encodedMatchKey = encodeURIComponent(normalizedMatchKey);
    const [match, teamMatches] = await Promise.all([
        getStatboticsJson(`/match/${encodedMatchKey}`),
        getStatboticsJson(`/team_matches?match=${encodedMatchKey}&limit=12`)
    ]);

    if (!match || typeof match !== 'object') {
        throw new Error(`Unable to load Statbotics data for match "${normalizedMatchKey}".`);
    }

    const redTeamMatches = getAllianceTeamMatches(match, teamMatches, 'red');
    const blueTeamMatches = getAllianceTeamMatches(match, teamMatches, 'blue');
    const redTotalEpa = getAllianceEpa(redTeamMatches, 'total_points');
    const blueTotalEpa = getAllianceEpa(blueTeamMatches, 'total_points');
    const redAutoEpa = getAllianceEpa(redTeamMatches, 'auto_points');
    const blueAutoEpa = getAllianceEpa(blueTeamMatches, 'auto_points');
    const redTeleopEpa = getAllianceEpa(redTeamMatches, 'teleop_points');
    const blueTeleopEpa = getAllianceEpa(blueTeamMatches, 'teleop_points');
    const redEndgameEpa = getAllianceEpa(redTeamMatches, 'endgame_points');
    const blueEndgameEpa = getAllianceEpa(blueTeamMatches, 'endgame_points');
    const { clientTeam, alliance: clientAlliance } = getClientAlliance(match, clientTeamNumber);
    if (!clientAlliance) {
        const teamDescription = clientTeam == null ? 'No client team was supplied' : `FRC ${clientTeam} is not assigned to this match`;
        throw new Error(`${teamDescription}. Provide the dashboard team number to generate an alliance-specific brief.`);
    }
    const prediction = match.pred || {};
    const redWinProbability = toFiniteNumber(prediction.red_win_prob);
    const ownAlliance = clientAlliance;
    const opponentAlliance = ownAlliance === 'red' ? 'blue' : 'red';
    const ownTeamMatches = ownAlliance === 'red' ? redTeamMatches : blueTeamMatches;
    const opponentTeamMatches = ownAlliance === 'red' ? blueTeamMatches : redTeamMatches;
    const ownAutoEpa = ownAlliance === 'red' ? redAutoEpa : blueAutoEpa;
    const opponentAutoEpa = ownAlliance === 'red' ? blueAutoEpa : redAutoEpa;
    const ownTeleopEpa = ownAlliance === 'red' ? redTeleopEpa : blueTeleopEpa;
    const opponentTeleopEpa = ownAlliance === 'red' ? blueTeleopEpa : redTeleopEpa;
    const ownEndgameEpa = ownAlliance === 'red' ? redEndgameEpa : blueEndgameEpa;
    const opponentEndgameEpa = ownAlliance === 'red' ? blueEndgameEpa : redEndgameEpa;
    const ownWinProbability = redWinProbability == null ? null : ownAlliance === 'red' ? redWinProbability : 1 - redWinProbability;
    const ownScore = toFiniteNumber(prediction?.[`${ownAlliance}_score`]);
    const opponentScore = toFiniteNumber(prediction?.[`${opponentAlliance}_score`]);
    const opponentLeader = getComponentLeader(opponentTeamMatches, 'total_points');
    const opponentAutoLeader = getComponentLeader(opponentTeamMatches, 'auto_points');
    const opponentTeleopLeader = getComponentLeader(opponentTeamMatches, 'teleop_points');
    const opponentEndgameLeader = getComponentLeader(opponentTeamMatches, 'endgame_points');
    const ownRpOpportunities = getRpOpportunities(prediction, ownAlliance);
    const ownSurrogates = match?.alliances?.[ownAlliance]?.surrogate_team_keys || [];
    const ownDqs = match?.alliances?.[ownAlliance]?.dq_team_keys || [];

    const lines = [`MATCH ${match.match_name || normalizedMatchKey} · YOU ARE ${ownAlliance.toUpperCase()}`];
    const projection = ownScore != null && opponentScore != null
        ? `Projected score: ${Math.round(ownScore)}–${Math.round(opponentScore)}.`
        : null;

    if (ownWinProbability != null) {
        const outlook = ownWinProbability >= 0.7
            ? 'You are favored—play clean and make them catch you.'
            : ownWinProbability >= 0.55
                ? 'You have a small edge—clean cycles and no penalties win it.'
                : ownWinProbability >= 0.45
                    ? 'This is a toss-up—every cycle and endgame point matters.'
                    : ownWinProbability >= 0.3
                        ? 'You are slight underdogs—take the simple points and stay connected.'
                        : 'They are favored—play your best match and look for a clean upset.';
        lines.push(`OUTLOOK: ${outlook}${projection ? ` ${projection}` : ''}`);
    } else if (projection) {
        lines.push(`OUTLOOK: ${projection}`);
    }

    lines.push(`YOUR JOB: ${getRoleRecommendation(clientTeam, ownTeamMatches, opponentTeamMatches, ownTeleopEpa, opponentTeleopEpa, ownWinProbability)}`);

    const watchItems = [];
    if (opponentLeader) {
        watchItems.push(`FRC ${opponentLeader.team} is their main scorer`);
    }
    if (opponentAutoLeader && opponentAutoEpa != null && ownAutoEpa != null && opponentAutoEpa - ownAutoEpa >= 1) {
        watchItems.push(`they have the better auto, led by FRC ${opponentAutoLeader.team}`);
    }
    if (opponentEndgameLeader && opponentEndgameEpa != null && ownEndgameEpa != null && opponentEndgameEpa - ownEndgameEpa >= 1) {
        watchItems.push(`FRC ${opponentEndgameLeader.team} is their endgame threat`);
    }
    if (watchItems.length > 0) {
        lines.push(`WATCH: ${watchItems.join('; ')}.`);
    }

    if (ownTeleopEpa != null && opponentTeleopEpa != null) {
        const teleopGap = ownTeleopEpa - opponentTeleopEpa;
        if (teleopGap <= -3 && opponentTeleopLeader) {
            lines.push(`PLAN: Keep scoring, but use short legal pressure on FRC ${opponentTeleopLeader.team} after auto. Leave in time for endgame.`);
        } else if (teleopGap >= 3) {
            lines.push('PLAN: Keep all three robots scoring when possible—do not trade your scoring advantage for full-time defense.');
        } else if (ownAutoEpa != null && opponentAutoEpa != null && ownAutoEpa - opponentAutoEpa <= -1) {
            lines.push('PLAN: Their auto may put you behind. Confirm non-conflicting auto paths, then win the traffic battle in teleop.');
        } else if (ownEndgameEpa != null && opponentEndgameEpa != null && ownEndgameEpa - opponentEndgameEpa <= -1) {
            lines.push('PLAN: Endgame is their edge. Do not get trapped late—leave early and finish cleanly.');
        } else {
            lines.push('PLAN: Keep lanes open, cycle cleanly, and avoid penalties. This match should be decided by execution.');
        }
    }

    const priorityRp = ownRpOpportunities.filter(({ probability }) => probability >= 0.65);
    const winIsUnlikely = ownWinProbability != null && ownWinProbability < 0.3;
    if (priorityRp.length > 0) {
        const opportunities = priorityRp
            .map(({ label, probability }) => `${label} is within reach (${formatPercent(probability)})`)
            .join('; ');
        lines.push(winIsUnlikely
            ? `RP PRIORITY: The win is unlikely, so prioritize these attainable bonus RPs: ${opportunities}. Do not give up a reliable RP just to chase the 3 win RPs.`
            : `RP: ${opportunities}. Go for it only after the win plan is covered.`);
    }

    if (Array.isArray(ownSurrogates) && ownSurrogates.length > 0) {
        lines.push(`SCHEDULE FLAG: ${formatTeams(ownSurrogates)} ${ownSurrogates.length === 1 ? 'is a surrogate' : 'are surrogates'}—verify ranking-point implications with the field staff.`);
    }
    if (Array.isArray(ownDqs) && ownDqs.length > 0) {
        lines.push(`SCHEDULE FLAG: ${formatTeams(ownDqs)} ${ownDqs.length === 1 ? 'is listed as a DQ' : 'are listed as DQs'} in the match data; confirm the lineup immediately.`);
    }

    return lines.join('\n');
}

async function getEventTeamMatches(eventKey) {
    const limit = 1000;

    for (const baseUrl of BASE_API_URLS) {
        try {
            const teamMatches = [];
            let offset = 0;

            while (true) {
                const response = await fetch(
                    `${baseUrl}/team_matches?event=${encodeURIComponent(eventKey)}&metric=time&ascending=true&limit=${limit}&offset=${offset}`,
                    { method: 'GET' }
                );

                if (!response.ok) {
                    throw new Error(`Statbotics endpoint failed (${response.status})`);
                }

                const page = await response.json();
                if (!Array.isArray(page)) {
                    throw new Error('Statbotics returned an invalid team_matches response');
                }

                teamMatches.push(...page);
                if (page.length < limit) {
                    return teamMatches;
                }

                offset += page.length;
            }
        } catch (error) {
            console.warn(`Statbotics team_matches fetch failed at ${baseUrl}`, error);
        }
    }

    return [];
}

async function populateTeamScores(listMatches, eventKey) {
    if (!Array.isArray(listMatches) || listMatches.length === 0 || !eventKey) {
        return listMatches;
    }

    const teamMatches = await getEventTeamMatches(eventKey);
    const predictionsByMatchAndTeam = new Map(
        teamMatches.map((teamMatch) => [`${teamMatch.match}:${teamMatch.team}`, teamMatch])
    );

    return listMatches.map((match) => {
        const populateAlliance = (allianceName) => {
            const alliance = match?.alliances?.[allianceName] || { team_keys: [] };
            const teamKeys = Array.isArray(alliance.team_keys) ? alliance.team_keys : [];

            return {
                ...alliance,
                team_predictions: teamKeys.map((teamKey) => {
                    const team = getTeamNumber(teamKey);
                    return predictionsByMatchAndTeam.get(`${match.key}:${team}`) || {
                        team,
                        match: match.key,
                        alliance: allianceName,
                        epa: null
                    };
                })
            };
        };

        return {
            ...match,
            alliances: {
                ...match.alliances,
                red: populateAlliance('red'),
                blue: populateAlliance('blue')
            }
        };
    });
}

export { sync, generatePreMatchBrief, getMatchContributionProjection, matchSchedule, percentSyncComplete, nextMatch };
