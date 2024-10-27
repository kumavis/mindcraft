import { makePromiseKit } from './promise-kit.js';

export const makePauseableActions = (actions) => {
    let promiseKit;
    const pauseableActions = {};
    for (const key in actions) {
        pauseableActions[key] = async (...args) => {
            if (promiseKit) await promiseKit.promise;
            return await actions[key](...args);
        };
    }

    return {
        actions: pauseableActions,
        pause: () => {
            if (promiseKit) return;
            promiseKit = makePromiseKit();
        },
        resume: () => {
            if (!promiseKit) return;
            promiseKit.resolve();
            promiseKit = null;
        },
    }
}

export const makeInflightTrackedActions = (actions) => {
    const inflightActions = new Set();
    const trackedActions = {};
    for (const key in actions) {
        trackedActions[key] = async (...args) => {
            const actionEntry = { key, args };
            inflightActions.add(actionEntry);
            try {
                return await actions[key](...args);
            } finally {
                inflightActions.delete(actionEntry);
            }
        };
    }
    return {
        actions: trackedActions,
        inflight: inflightActions,
    }
}

export const makePausableActionsWithRestart = (actions) => {
    const { actions: trackedActions, inflight } = makeInflightTrackedActions(actions);
    const { actions: pauseableActions, pause, resume } = makePauseableActions(trackedActions);
    return {
        actions: pauseableActions,
        pause,
        resume () {
            for (const { key, args } of inflight) {
                trackedActions[key](...args);
            }
            resume();
        },
    }
}
