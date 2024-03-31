import utils from './utils.js';
import { dirname } from 'path'
import { fileURLToPath } from 'url'
import { exec } from 'child_process';
import debugModule from 'debug'
import fs from 'fs'
const debug = debugModule('ring-mqtt')

export function recordAndUpload() {
    if(utils.config().record_id == null || utils.config().record_id.trim() === '') {
        const configFile = (process.env.RUNMODE === 'standard') ? dirname(fileURLToPath(new URL('.', import.meta.url)))+'/config/go2rtc.yaml' : '/data/go2rtc.yaml'
        debug(`Config file found at ${configFile}`)
        const readConfigFile = fs.readFileSync(configFile, 'utf8');
        const searchConfigForMatch = readConfigFile.match(/^\s*(\S+_live):\s+/m);
        const keyWithLive = searchConfigForMatch ? searchConfigForMatch[1] : null;
        if (!keyWithLive) {
            throw new Error(`Error: No key ending with "_live" found in the go2rtc YAML file.`);
        }else{
            utils.config().record_id = keyWithLive;
        }        
    }

    let streamSourceUrlBase
    /*
    if (process.env.RUNMODE === 'addon') {
        streamSourceUrlBase = process.env.ADDONHOSTNAME
    } else if (process.env.RUNMODE === 'docker') {
        //streamSourceUrlBase = utils.getHostIp()
    } else {
        streamSourceUrlBase = utils.getHostFqdn()
    }
    */
   streamSourceUrlBase = "127.0.0.1" //Needs to be dynamic but localhost wil work in my case.
   
    const liveStreamUrl = (utils.config().livestream_user && utils.config().livestream_pass)
    ? `rtsp://${utils.config().livestream_user}:${utils.config().livestream_pass}@${streamSourceUrlBase}:8554/${utils.config().record_id}`
    : `rtsp://${streamSourceUrlBase}:8554/${utils.config().record_id}`

    return new Promise((resolve, reject) => {
        const fileName = `${new Date().toISOString().replace(/[-:.]/g, '')}_${utils.config().record_filename}.mov`;
        debug(`Start recording this stream: ${liveStreamUrl} to this file: ${fileName}`)

        const ffmpegCmd = `ffmpeg -rtsp_transport tcp -y -i ${liveStreamUrl} -t ${utils.config().record_time} -vcodec copy -acodec copy /tmp/${fileName}`;
        const curlCmd = `curl --upload-file /tmp/${fileName} ftp://${utils.config().ftp_user}:${utils.config().ftp_password}@${utils.config().ftp_ip}/${utils.config().ftp_folder}/${fileName}`;
        exec(`${ffmpegCmd} && ${curlCmd}`, (error, stdout, stderr) => {
            if (error) {
                debug(`Error: ${error.message}`);
                return;
            }
        
            debug(`Curl Command Output: ${stdout}`);
            
            if (stderr) {
                debug(`Curl Command Error: ${stderr}`);
            } else {
                debug(`Recorded and uploaded file: ${fileName}`);
            }
        
            exec(`rm /tmp/${fileName}`, (error) => {
                if (error) {
                    debug(`Error while deleting file: ${error.message}`);
                    return;
                }
                debug(`File ${fileName} deleted successfully`);
            });
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
