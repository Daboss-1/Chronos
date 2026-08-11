var matchSchedule = [];
var percentSyncComplete = 0;
var syncIndex = 0;
var nextMatch = null;
const BASE_API_URLS = ['https://api.statbotics.io/v3', 'https://statbotics-production.up.railway.app/v3', 'https://api-statbotics.iterativerefinement.com/v3']
async function getTeamEventKey(teamNumber) {
    var closestKey = null;
    var now = new Date().getTime();
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
    var matchSchedule = [];
    if (!eventKey) {
        return matchSchedule;
    }
    await fetch(`https://www.thebluealliance.com/api/v3/event/${eventKey}/matches`, {
        method: 'GET',
        headers: {
            'X-TBA-Auth-Key': 'KGSCksKxS2Z5m3DMlj0DaEjzW7hphTOnAkEhAzJj5lBDEiheTNB9Stw2akjIgGDX'
        }
    })
        .then(response => response.json())
        .then(data => {
            console.log(data)
            const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
            let teamMatches = data
                .filter(match => match.alliances.red.team_keys.includes(`frc${teamNumber}`) || match.alliances.blue.team_keys.includes(`frc${teamNumber}`))
                .map(match => ({
                    key: match.key,
                    match_number: match.match_number,
                    predicted_day_time: new Date(match.predicted_time * 1000).toLocaleString('en', timeZone),
                    predicted_time: match.predicted_time,
                    alliances: match.alliances
                }));
            teamMatches.sort((a, b) => a.predicted_time - b.predicted_time);
            matchSchedule = teamMatches;
        })
        .catch(error => console.log(error));
    return matchSchedule;
}

async function getWinPredictionForTeam(teamNumber, match, amtMatches) {
    let winChance = 0.5;
    let i = 0;
    let valid = false;
    while (!valid && i < BASE_API_URLS.length) {
        await fetch(`${BASE_API_URLS[i]}/match/${match.key}`, {
            method: 'GET'
        })
            .then(response => response.json())
            .then(data => {
                if (data.pred) {
                    winChance = (data.alliances.red.team_keys.includes(teamNumber) ? data.pred.red_win_prob : 1 - data.pred.red_win_prob);
                    valid = true;
                }
            })
            .catch(error => {
                console.log('Unable to get win predictions - probably because the match is off-season. Trying other endpoint...');
            });

        i += 1;
    }
    match.prediction = winChance;
    syncIndex += 1;
    percentSyncComplete = 2 / 3 + 1 / 3 * (syncIndex / amtMatches);
    return match;
}

async function sync(teamNumber) {
    teamNumber = parseInt(teamNumber.toString().replace(/\s/g, ''), 10);
    percentSyncComplete = 0;
    syncIndex = 0;

    const eventKey = await getTeamEventKey(teamNumber);
    if (!eventKey) {
        matchSchedule = [];
        nextMatch = null;
        percentSyncComplete = 100;
        return;
    }
    percentSyncComplete = 100 / 3;

    const schedule = await getTeamEventMatchSchedule(teamNumber, eventKey);
    percentSyncComplete = 200 / 3;

    matchSchedule = await Promise.all(
        schedule.map(match => getWinPredictionForTeam(teamNumber, match, schedule.length))
    );
    setNextMatch(matchSchedule);
    console.log(nextMatch)
    if (schedule.length === 0) {
        nextMatch = null;
        percentSyncComplete = 100;
    }
    


}

async function predSync(teamNumber) {
    if (matchSchedule.length == 0) {
        await sync(teamNumber);
    } else {
        teamNumber = parseInt(teamNumber.toString().replace(/\s/g, ''), 10);
        percentSyncComplete = 0;
        syncIndex = 0;
        percentSyncComplete = 200 / 3;
        matchSchedule = await Promise.all(
            matchSchedule.map(match => getWinPredictionForTeam(teamNumber, match, matchSchedule.length))
        );
        setNextMatch(matchSchedule);
        if (matchSchedule.length === 0) {
            nextMatch = null;
            percentSyncComplete = 100;
        }
    }
}

async function timeSync(teamNumber) {
    if (matchSchedule.length == 0) {
        await sync(teamNumber);
    } else {
        teamNumber = parseInt(teamNumber.toString().replace(/\s/g, ''), 10);
        percentSyncComplete = 0;
        syncIndex = 0;
        percentSyncComplete = 200 / 3;
        const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
        for (let i = 0; i < matchSchedule.length; i++) {
            const response = await fetch(`https://www.thebluealliance.com/api/v3/match/${matchSchedule[i].key}`, {
                method: 'GET',
                headers: {
                    'X-TBA-Auth-Key': 'KGSCksKxS2Z5m3DMlj0DaEjzW7hphTOnAkEhAzJj5lBDEiheTNB9Stw2akjIgGDX'
                }
            })
            const responseJson = await response.json()
            matchSchedule[i].predicted_day_time = new Date(responseJson.predicted_time * 1000).toLocaleString('en', timeZone)
            matchSchedule[i].predicted_time = responseJson.predicted_time
            percentSyncComplete = 200 / 3 + 100 / 3 * (i + 1) / matchSchedule.length;
        }
        setNextMatch(matchSchedule);
        percentSyncComplete = 100;
    }
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
        if (match?.score_breakdown != null) {
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

    let now = new Date().getTime() / 1000;
    nextMatch = null;
    let closestPositiveDistance = Number.POSITIVE_INFINITY;
    for (let i = 0; i < listMatches.length; i++) {
        let distance = listMatches[i].predicted_time - now;
        if (distance > 0 && distance < closestPositiveDistance) {
            closestPositiveDistance = distance;
            nextMatch = listMatches[i];
        }
    }

    return nextMatch;
}

export { sync, predSync, timeSync, matchSchedule, percentSyncComplete, nextMatch };
