import { makePromiseKit, makeTimeoutReject } from "./library/promise-kit.js";
export class ResumeFromStartTask {
    constructor(label, taskFn) {
        this.label = label;
        this.resultLog = '';
        this._taskFn = taskFn;
        this._promiseKit = makePromiseKit();
    }

    start () {
        this._promiseKit.resolve(this._taskFn());
        return this._promiseKit.promise;
    }

    pause () {
        // no way to trigger a stop for this task
        return this._promiseKit.promise;
    }

    resume () {
        // this._taskPromise = Promise.resolve(this._taskFn());
        // return this._taskPromise;
        throw Error('Cannot resume a task that has already started.');
    }

    whenDone () {
        return this._promiseKit.promise;
    }

}

export class TaskManager {
    constructor(agent) {
        this.agent = agent;
        this.executing = false;
        // this.currentTaskLabel = '';
        // this.currentTaskFn = null;
        // this.timedout = false;
        // this.resume_func = null;
        // this.resume_name = '';
        this.taskQueue = [];
    }

    // TODO: remove
    async resumeTask(taskFn, timeout) {
        if (taskFn) {
            return this.runTask('(resume)', taskFn, { timeout, resume: true });
        } else {
            return this.start();
        }
    }

    async runTask(taskLabel, taskFn, { timeout, resume = false } = {}) {
        // const task = {
        //     label: taskLabel,
        //     start: taskFn,
        //     timeout: timeout,
        //     resumable: resume
        // };
        // if (resume) {
        //     const task = new ResumeFromStartTask(taskLabel, taskFn);
        //     return this._executeResume(taskFn, timeout);
        // } else {
        const task = new ResumeFromStartTask(taskLabel, taskFn);
        return this._executeTask(task);
        // }
    }

    async stop() {
        if (!this.executing) return;
        const task = this.getCurrentTask()
        if (!task) return;
        // update task log
        task.resultLog += this.agent.captureBotLogs();
        this.agent.bot.emit('task:pause', task.label);
        try {
            // attempt graceful stop with 10 seconds timeout
            await Promise.race([
                task.pause(),
                makeTimeoutReject(10 * 1000, 'Task failed to gracefully stop after 10 seconds.'),
            ]);
        } catch (err) {
            console.error(err);
            this.agent.bot.emit('task:interrupt', task.label);
            this.agent.cleanKill(`${err.message} Killing process.`);
            return;
        } finally {
            this.executing = false;
            // this.agent.bot.emit('task:end', task.label);
        }
    }

    cancelResume() {
        console.log('Cancel resume requested (ignored).');
    }

    start () {
        if (this.executing) return;
        this._startNextTask();
    }

    getCurrentTask() {
        return this.taskQueue[0];
    }

    _taskHasCompleted (task) {
        this.agent.bot.emit('task:end', task.label);
        // we're done executing
        this.executing = false;
        // remove task
        const taskIndex = this.taskQueue.indexOf(task);
        if (taskIndex !== -1) {
            this.taskQueue.splice(taskIndex, 1);
        }
        // announce idle if no more tasks
        if (this.taskQueue.length === 0) {
            this.agent.bot.emit('idle');
            return;
        }
        this._startNextTask();
    }

    _startNextTask() {
        if (this.executing) {
            throw Error('Cannot start next task while current task is executing.');
        }
        if (this.taskQueue.length === 0) {
            return;
        }
        this.executing = true;
        const task = this.getCurrentTask();
        this.agent.bot.emit('task:start', task.label);
        this.agent.clearBotLogs();
        task.start()
            .catch((err) => {
                console.error(err);
                this.agent.bot.emit('task:error', { task: task.label, error: err });
                this.agent.cleanKill(`Task Failed: ${err.message}. Killing process.`);
            })
            .finally(() => {
                this._taskHasCompleted(task);
            });
    }

    async _executeTask(task) {
        if (this.executing) {
            await this.stop();
        }
        this.taskQueue.unshift(task);
        this._startNextTask();
        return task.whenDone()
            .then(() => {
                task.resultLog += this.agent.captureBotLogs();
                console.log('Task done:', task.label, task.resultLog);
                return { success: true, message: task.resultLog, interrupted: false, timedout: false };
            })
            .catch((err) => {
                return { success: false, message: null, interrupted: false, timedout: false };
            });
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
            this.agent.bot.emit('task:timeout', this.currentTaskLabel);
            await this.stop(); // last attempt to stop
        }, TIMEOUT_MINS * 60 * 1000);
    }

}