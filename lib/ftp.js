import utils from './utils.js';
import { exec } from 'child_process';
import debugModule from 'debug'
const debug = debugModule('ring-mqtt')

export function recordAndUpload() {
    
    const streamIp = utils.config().mqtt_url.match(/(?:[0-9]{1,3}\.){3}[0-9]{1,3}/)[0];
    const liveStreamUrl = `rtsp://${utils.config().livestream_user}:${utils.config().livestream_pass}@${streamIp}:8554/${deviceId}_live`;

    return new Promise((resolve, reject) => {
        const fileName = `${new Date().toISOString().replace(/[-:.]/g, '')}_${utils.config().record_filename}.mov`;
        debug(`Start recording this stream: ${liveStreamUrl} to this file: ${fileName}`)

        const ffmpegCmd = `ffmpeg -rtsp_transport tcp -y -i ${liveStreamUrl} -t ${utils.config().record_time} -vcodec copy -acodec copy /tmp/${fileName}`;
        const curlCmd = `curl --upload-file /tmp/${fileName} ftp://${utils.config().ftp_user}:${utils.config().ftp_password}@${utils.config().ftp_ip}/${utils.config().ftp_folder}/${fileName}`;
        exec(`${ffmpegCmd} && ${curlCmd} && rm /tmp/${fileName}`, (error, stdout, stderr) => {
            if (error) {
                reject(new Error(`Error: ${error.message}`));
            } else {
                debug(`Recorded and uploaded file: ${fileName}`)
                resolve();
            }
        });
    });
}

export function checkAndDeleteFiles() {
    return new Promise((resolve, reject) => {
        exec(`sshpass -p "${utils.config().ssh_password}" ssh "${utils.config().ssh_user}"@"${utils.config().ssh_ip}" "find "${utils.config().ssh_path}" -type f | wc -l"`, (error, stdout, stderr) => {
            if (error) {
                reject(`Error executing sshpass: ${error}`);
            } else {
                const fileCount = parseInt(stdout.trim());
                debug(`Files found ${fileCount}`)

                if (fileCount > utils.config().delete_period) {
                    exec(`sshpass -p "${utils.config().ssh_password}" ssh -o StrictHostKeyChecking=no "${utils.config().ssh_user}"@"${utils.config().ssh_ip}" "find "${utils.config().ssh_path}" -type f -printf '%T+ %p\n' | sort | head -n 1 | cut -d' ' -f2-"`, (error, stdout, stderr) => {
                        if (error) {
                            reject(`Error executing sshpass for deleting oldest file: ${error}`);
                        } else {
                            const oldestFile = stdout.trim();
                            debug(`Oldest file is being deleted: ${oldestFile}`)
                            exec(`sshpass -p "${utils.config().ssh_password}" ssh -o StrictHostKeyChecking=no "${utils.config().ssh_user}"@"${utils.config().ssh_ip}" "rm ${oldestFile}"`, (error, stdout, stderr) => {
                                if (error) {
                                    reject(`Error deleting oldest file: ${error}`);
                                } else {
                                    console.log(stdout);
                                    resolve();
                                }
                            });
                        }
                    });
                } else {
                    resolve();
                }
            }
        });
    });
}
