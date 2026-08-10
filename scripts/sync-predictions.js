var matchSchedule = [];
var percentSyncComplete = 0;
var syncIndex = 0;
const BASE_API_URLS = ['https://api.statbotics.io/v3/', 'https://api-statbotics.iterativerefinement.com/', 'https://statbotics-production.up.railway.app']
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
        await fetch(`${BASE_API_URLS[i]}/v3/match/${match.key}`, {
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
    teamNumber = parseInt(teamNumber.replace(/\s/g, ''), 10);
    percentSyncComplete = 0;
    syncIndex = 0;

    const eventKey = await getTeamEventKey(teamNumber);
    if (!eventKey) {
        matchSchedule = [];
        percentSyncComplete = 100;
        return;
    }
    percentSyncComplete = 33;

    const schedule = await getTeamEventMatchSchedule(teamNumber, eventKey);
    percentSyncComplete = 66;

    matchSchedule = await Promise.all(
        schedule.map(match => getWinPredictionForTeam(teamNumber, match, schedule.length))
    );

    if (schedule.length === 0) {
        percentSyncComplete = 100;
    }
}

export { sync, matchSchedule, percentSyncComplete };
