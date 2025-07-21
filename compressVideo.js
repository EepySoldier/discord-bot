// compressVideo.js
const ffmpegPath = require('ffmpeg-static');
const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const os = require('os');
const fs = require('fs');

ffmpeg.setFfmpegPath(ffmpegPath);

function compressVideo(inputPath) {
    return new Promise((resolve, reject) => {
        // Create a temp directory for output inside the OS temp folder
        const tempDir = path.join(os.tmpdir(), 'video-processing');
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
        }

        // Create unique output file name with .mp4 extension
        const outputPath = path.join(tempDir, `compressed_${Date.now()}.mp4`);

        ffmpeg(inputPath)
            .videoCodec('libx264')
            .outputOptions('-crf 28')
            .on('error', (err) => {
                console.error('FFmpeg error:', err);
                reject(err);
            })
            .on('end', () => {
                console.log('✅ Compression finished:', outputPath);
                resolve(outputPath);
            })
            .save(outputPath);
    });
}

module.exports = { compressVideo };
