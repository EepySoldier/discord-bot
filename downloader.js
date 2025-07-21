const axios = require('axios');
const fs = require('fs');
const path = require('path');

async function downloadVideo(url, filename) {
    const filepath = path.join('/tmp', filename);
    const writer = fs.createWriteStream(filepath);

    const response = await axios({
        url,
        method: 'GET',
        responseType: 'stream',
    });

    response.data.pipe(writer);

    return new Promise((resolve, reject) => {
        writer.on('finish', () => resolve(filepath));
        writer.on('error', reject);
    });
}

module.exports = { downloadVideo };
