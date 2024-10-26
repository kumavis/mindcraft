export class TaskManager {
    constructor(agent) {
        this.agent = agent;
        this.executing = false;
        this.currentTaskLabel = '';
        this.currentTaskFn = null;
        this.timedout = false;
        this.resume_func = null;
        this.resume_name = '';
    }

    async resumeTask(taskFn, timeout) {
        return this._executeResume(taskFn, timeout);
    }

    async runTask(taskLabel, taskFn, { timeout, resume = false } = {}) {
        if (resume) {
            return this._executeResume(taskFn, timeout);
        } else {
            return this._executeTask(taskLabel, taskFn, timeout);
        }
    }

    async stop() {
        if (!this.executing) return;
        console.trace();
        const start = Date.now();
        while (this.executing) {
            this.agent.interruptBot();
            console.log('waiting for code to finish executing...');
            await new Promise(resolve => setTimeout(resolve, 1000));
            if (Date.now() - start > 10 * 1000) {
                this.agent.cleanKill('Code execution refused stop after 10 seconds. Killing process.');
            }
        }
    }

    cancelResume() {
        this.resume_func = null;
        this.resume_name = null;
    }

    async _executeResume(taskFn = null, timeout = 10) {
        const new_resume = taskFn != null;
        if (new_resume) { // start new resume
            this.resume_func = taskFn;
            this.resume_name = this.currentTaskLabel;
        }
        if (this.resume_func != null && this.agent.isIdle() && (!this.agent.self_prompter.on || new_resume)) {
            this.currentTaskLabel = this.resume_name;
            let res = await this._executeTask(this.resume_name, this.resume_func, timeout);
            this.currentTaskLabel = '';
            return res;
        } else {
            return { success: false, message: null, interrupted: false, timedout: false };
        }
    }

    async _executeTask(taskLabel, taskFn, timeout = 10) {
        let TIMEOUT;
        try {
            console.log('executing code...\n');

            // await current task to finish (executing=false), with 10 seconds timeout
            // also tell agent.bot to stop various actions
            if (this.executing) {
                console.log(`new task "${taskLabel}" trying to interrupt current task "${this.currentTaskLabel}"`);
            }
            await this.stop();

            // clear bot logs and reset interrupt code
            this.agent.clearBotLogs();

            this.executing = true;
            this.currentTaskLabel = taskLabel;
            this.currentTaskFn = taskFn;

            // timeout in minutes
            if (timeout > 0) {
                TIMEOUT = this._startTimeout(timeout);
            }

            // start the task
            await taskFn();

            // mark task as finished + cleanup
            this.executing = false;
            this.currentTaskLabel = '';
            this.currentTaskFn = null;
            clearTimeout(TIMEOUT);

            // get bot activity summary
            let output = this._getBotOutputSummary();
            let interrupted = this.agent.bot.interrupt_code;
            let timedout = this.timedout;
            this.agent.clearBotLogs();

            // if not interrupted and not generating, emit idle event
            if (!interrupted && !this.agent.coder.generating) {
                this.agent.bot.emit('idle');
            }

            // return task status report
            return { success: true, message: output, interrupted, timedout };
        } catch (err) {
            this.executing = false;
            this.currentTaskLabel = '';
            this.currentTaskFn = null;
            clearTimeout(TIMEOUT);
            this.cancelResume();
            console.error("Code execution triggered catch: " + err);
            await this.stop();

            let message = this._getBotOutputSummary() + '!!Code threw exception!!  Error: ' + err;
            let interrupted = this.agent.bot.interrupt_code;
            this.agent.clearBotLogs();
            if (!interrupted && !this.agent.coder.generating) {
                this.agent.bot.emit('idle');
            }
            return { success: false, message, interrupted, timedout: false };
        }
    }

    _getBotOutputSummary() {
        const { bot } = this.agent;
        if (bot.interrupt_code && !this.timedout) return '';
        let output = bot.output;
        const MAX_OUT = 500;
        if (output.length > MAX_OUT) {
            output = `Code output is very long (${output.length} chars) and has been shortened.\n
          First outputs:\n${output.substring(0, MAX_OUT / 2)}\n...skipping many lines.\nFinal outputs:\n ${output.substring(output.length - MAX_OUT / 2)}`;
        }
        else {
            output = 'Code output:\n' + output;
        }
        return output;
    }

    _startTimeout(TIMEOUT_MINS = 10) {
        return setTimeout(async () => {
            console.warn(`Code execution timed out after ${TIMEOUT_MINS} minutes. Attempting force stop.`);
            this.timedout = true;
            this.agent.history.add('system', `Code execution timed out after ${TIMEOUT_MINS} minutes. Attempting force stop.`);
            await this.stop(); // last attempt to stop
        }, TIMEOUT_MINS * 60 * 1000);
    }

}