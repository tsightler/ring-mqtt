---
name: Bug report
about: Submit an issue with ring-mqtt
title: ''
labels: 'bug'
assignees: tsightler
---

If you are using the Ring Devices Addon for Home Assistant, and the issue you are reporting is related to installing, configuring or operating the script within a Home Asssitant Supervised installation, you should probably not be opening an issue on this project, but rather on the Ring-MQTT Home Assistant Addon project:
https://github.com/tsightler/ring-mqtt-ha-addon

Note that if you are unsure, it's not a major issue, but I may move your issue between the projects.

**!!!! Important note regarding camera support !!!!**    
The ring-mqtt project does not magically turn Ring cameras into 24x7/continuous streaming CCTV cameras.  Ring cameras are designed to work with Ring cloud servers for on-demand streaming based on detected events (motion/ding) or interactive viewing.  Even when using ring-mqtt, all streaming still goes through Ring cloud servers and is not local.  Attempting to leverage this project for continuous streaming is not a supported use case and attempts to do so will almost certainly end in disappointment.  Any support cases opened for issues with continuous streaming (i.e. more than one streaming session back-to-back) will be closed as unsupported.  This includes use with NVR tools like Frigate or motionEye.

### !!!! PLEASE READ THIS FIRST !!!! ###
This is a community project and opening an issue indicates that you are prepared to interact as a community member.  Note that this does not mean that I expect you to be a developer or a super tech guru, but you must at least be willing to put some time and effort into helping me understand your environment, answer questions, provide logs, and do so in a reasonably timely manner.  In general I will do my best to help whenever I can, but I answer these issues on my own personal time and my effort to do so will largely be commensurate to the effort that you put in.  I'm sorry for being so blunt, but recently, the number of people that opened issues with a single sentence, or that open an issue and then never respond to any requests for additional information, has grown to the point that it really makes working on this project less than enjoyable, and that puts the entire project at risk.

I don't want to discourage users from opening an issue if there is a problem, I promise that, if the appropriate effort is made, I will do my best to meet that effort, assuming available time.  Please remember that I am not associated with Ring in any way, other than the fact that I own some of their products, I can't help you solve problems with your Ring devices and I can't do anything about their limitations, I suffer with those limitations just like you do.  The goal of this project is simply to make it as easy as possible to integrate the features of Ring products the home automation platform of your choice.

**Describe the bug**  
A clear and concise description of the issue.  Please enter a brief summary of the issue in the title above as well.

**Describe your environment**  
Please include details on your enviornment, including OS versions, platform, etc.

**Describe your settings and what you've tried**  
Please make sure to share you configuration settings (other than sensitive information like token, etc) and anything you have done to attempt to solve the problem to this point.

**Debug Logs**  
In many cases the only way to effectively troubleshoot an issue is to review the logs, without this, I'll mostly just be guessing at the problem.  Please run the script with DEBUG=ring-* enabled (note this is enabled by default for the addon and Docker versions) and collect logs.  Logs will likely contain potentially sensitive information so you probably do not want to post them publicly on Github, which I certainly understand.  Please feel free to send the logs, or a link to download them, to my personal email address, which is the same username at gmail and be sure to reference the open issue by number or link.
