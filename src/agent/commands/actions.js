import * as skills from '../library/skills.js';
import { makePauseableActions } from '../library/pausable.js';
import settings from '../../../settings.js';
import { makePromiseKit } from '../library/promise-kit.js';
import { SelfPrompter } from '../self_prompter.js';


function makeActionTaskRunnerPauseable (taskLabel, taskFn) {
    return async (agent, ...args) => {
        // build task
        const pauseable = makePauseableActions(skills);
        const pauseableSkills = pauseable.actions;
        const taskPromiseKit = makePromiseKit();
        const task = {
            label: taskLabel,
            start: async () => {
                const taskPromise = taskFn(pauseableSkills, agent, ...args);
                taskPromiseKit.resolve(taskPromise);
                return taskPromiseKit.promise;
            },
            pause: async () => {
                pauseable.pause();
                agent.interruptBot();
            },
            resume: async () => {
                pauseable.resume();
            },
            whenDone: () => {
                return taskPromiseKit.promise;
            }
        }
        // run task
        // TODO: fix call
        const code_return = await agent.tasks._executeTask(task);
        if (code_return.interrupted && !code_return.timedout)
            return;
        return code_return.message;
    }
}

function makeActionTaskRunner (taskLabel, taskFn) {
    return async (agent, ...args) => {
        // build task
        const taskFinalizationPromiseKit = makePromiseKit();
        let currentTaskPromise = null;
        const setCurrentTaskPromise = (taskPromise) => {
            if (currentTaskPromise) {
                // ignore errors from previous task
                currentTaskPromise.catch(() => {});
            }
            currentTaskPromise = taskPromise;
            if (!taskPromise) return;
            taskPromise.finally(() => {
                if (taskPromise !== currentTaskPromise) return;
                taskFinalizationPromiseKit.resolve(taskPromise);
            });
        };
        const task = {
            label: taskLabel,
            resultLog: '',
            start: async () => {
                const taskPromise = taskFn(skills, agent, ...args);
                setCurrentTaskPromise(taskPromise);
                return taskFinalizationPromiseKit.promise;
            },
            pause: async () => {
                // we want to discard the current task first
                // so we can ignore the errors from interrupting it
                setCurrentTaskPromise(undefined);
                agent.interruptBot();
            },
            resume: async () => {
                if (currentTaskPromise) return;
                const taskPromise = taskFn(skills, agent, ...args);
                setCurrentTaskPromise(taskPromise);
            },
            whenDone: () => {
                return taskFinalizationPromiseKit.promise;
            }
        }
        // run task
        // TODO: fix call
        const code_return = await agent.tasks._executeTask(task);
        if (code_return.interrupted && !code_return.timedout)
            return;
        return code_return.message;
    }
}

export const actionsList = [
    {
        name: '!newAction',
        description: 'Perform new and unknown custom behaviors that are not available as a command.', 
        params: {
            'prompt': { type: 'string', description: 'A natural language prompt to guide code generation. Make a detailed step-by-step plan.' }
        },
        perform: async function (agent, prompt) {
            // just ignore prompt - it is now in context in chat history
            if (!settings.allow_insecure_coding)
                return 'newAction not allowed! Code writing is disabled in settings. Notify the user.';
            return await agent.coder.generateCode(agent.history);
        }
    },
    {
        name: '!stop',
        description: 'Force stop all actions and commands that are currently executing.',
        perform: async function (agent) {
            await agent.tasks.stop();
            agent.clearBotLogs();
            agent.tasks.cancelResume();
            agent.bot.emit('idle');
            let msg = 'Agent stopped.';
            if (agent.self_prompter.on)
                msg += ' Self-prompting still active.';
            return msg;
        }
    },
    {
        name: '!stfu',
        description: 'Stop all chatting and self prompting, but continue current action.',
        perform: async function (agent) {
            agent.bot.chat('Shutting up.');
            agent.shutUp();
            return;
        }
    },
    {
        name: '!restart',
        description: 'Restart the agent process.',
        perform: async function (agent) {
            await agent.history.save();
            agent.cleanKill();
        }
    },
    {
        name: '!clearChat',
        description: 'Clear the chat history.',
        perform: async function (agent) {
            agent.history.clear();
            return agent.name + "'s chat history was cleared, starting new conversation from scratch.";
        }
    },
    {
        name: '!goToPlayer',
        description: 'Go to the given player.',
        params: {
            'player_name': {type: 'string', description: 'The name of the player to go to.'},
            'closeness': {type: 'float', description: 'How close to get to the player.', domain: [0, Infinity]}
        },
        perform: makeActionTaskRunner('goToPlayer', async (skills, agent, player_name, closeness) => {
            return await skills.goToPlayer(agent.bot, player_name, closeness);
        })
    },
    {
        name: '!followPlayer',
        description: 'Endlessly follow the given player. Will defend that player if self_defense mode is on.',
        params: {
            'player_name': {type: 'string', description: 'name of the player to follow.'},
            'follow_dist': {type: 'float', description: 'The distance to follow from.', domain: [0, Infinity]}
        },
        perform: makeActionTaskRunner('followPlayer', async (skills, agent, player_name, follow_dist) => {
            await skills.followPlayer(agent.bot, player_name, follow_dist);
        }, true)
    },
    {
        name: '!goToBlock',
        description: 'Go to the nearest block of a given type.',
        params: {
            'type': { type: 'BlockName', description: 'The block type to go to.' },
            'closeness': { type: 'float', description: 'How close to get to the block.', domain: [0, Infinity] },
            'search_range': { type: 'float', description: 'The distance to search for the block.', domain: [0, Infinity] }
        },
        perform: makeActionTaskRunner('goToBlock', async (skills, agent, type, closeness, range) => {
            await skills.goToNearestBlock(agent.bot, type, closeness, range);
        })
    },
    {
        name: '!moveAway',
        description: 'Move away from the current location in any direction by a given distance.',
        params: {'distance': { type: 'float', description: 'The distance to move away.', domain: [0, Infinity] }},
        perform: makeActionTaskRunner('moveAway', async (skills, agent, distance) => {
            await skills.moveAway(agent.bot, distance);
        })
    },
    {
        name: '!rememberHere',
        description: 'Save the current location with a given name.',
        params: {'name': { type: 'string', description: 'The name to remember the location as.' }},
        perform: async function (agent, name) {
            const pos = agent.bot.entity.position;
            agent.memory_bank.rememberPlace(name, pos.x, pos.y, pos.z);
            return `Location saved as "${name}".`;
        }
    },
    {
        name: '!goToPlace',
        description: 'Go to a saved location.',
        params: {'name': { type: 'string', description: 'The name of the location to go to.' }},
        perform: makeActionTaskRunner('goToPlace', async (skills, agent, name) => {
            const pos = agent.memory_bank.recallPlace(name);
            if (!pos) {
            skills.log(agent.bot, `No location named "${name}" saved.`);
            return;
            }
            await skills.goToPosition(agent.bot, pos[0], pos[1], pos[2], 1);
        })
    },
    {
        name: '!givePlayer',
        description: 'Give the specified item to the given player.',
        params: { 
            'player_name': { type: 'string', description: 'The name of the player to give the item to.' }, 
            'item_name': { type: 'ItemName', description: 'The name of the item to give.' },
            'num': { type: 'int', description: 'The number of items to give.', domain: [1, Number.MAX_SAFE_INTEGER] }
        },
        perform: makeActionTaskRunner('givePlayer', async (skills, agent, player_name, item_name, num) => {
            await skills.giveToPlayer(agent.bot, item_name, player_name, num);
        })
    },
    {
        name: '!consume',
        description: 'Eat/drink the given item.',
        params: {'item_name': { type: 'ItemName', description: 'The name of the item to consume.' }},
        perform: makeActionTaskRunner('consume', async (skills, agent, item_name) => {
            await agent.bot.consume(item_name);
            skills.log(agent.bot, `Consumed ${item_name}.`);
        })
    },
    {
        name: '!equip',
        description: 'Equip the given item.',
        params: {'item_name': { type: 'ItemName', description: 'The name of the item to equip.' }},
        perform: makeActionTaskRunner('equip', async (skills, agent, item_name) => {
            await skills.equip(agent.bot, item_name);
        })
    },
    {
        name: '!putInChest',
        description: 'Put the given item in the nearest chest.',
        params: {
            'item_name': { type: 'ItemName', description: 'The name of the item to put in the chest.' },
            'num': { type: 'int', description: 'The number of items to put in the chest.', domain: [1, Number.MAX_SAFE_INTEGER] }
        },
        perform: makeActionTaskRunner('putInChest', async (skills, agent, item_name, num) => {
            await skills.putInChest(agent.bot, item_name, num);
        })
    },
    {
        name: '!takeFromChest',
        description: 'Take the given items from the nearest chest.',
        params: {
            'item_name': { type: 'ItemName', description: 'The name of the item to take.' },
            'num': { type: 'int', description: 'The number of items to take.', domain: [1, Number.MAX_SAFE_INTEGER] }
        },
        perform: makeActionTaskRunner('takeFromChest', async (skills, agent, item_name, num) => {
            await skills.takeFromChest(agent.bot, item_name, num);
        })
    },
    {
        name: '!viewChest',
        description: 'View the items/counts of the nearest chest.',
        params: { },
        perform: makeActionTaskRunner('viewChest', async (skills, agent) => {
            await skills.viewChest(agent.bot);
        })
    },
    {
        name: '!discard',
        description: 'Discard the given item from the inventory.',
        params: {
            'item_name': { type: 'ItemName', description: 'The name of the item to discard.' },
            'num': { type: 'int', description: 'The number of items to discard.', domain: [1, Number.MAX_SAFE_INTEGER] }
        },
        perform: makeActionTaskRunner('discard', async (skills, agent, item_name, num) => {
            const start_loc = agent.bot.entity.position;
            await skills.moveAway(agent.bot, 5);
            await skills.discard(agent.bot, item_name, num);
            await skills.goToPosition(agent.bot, start_loc.x, start_loc.y, start_loc.z, 0);
        })
    },
    {
        name: '!collectBlocks',
        description: 'Collect the nearest blocks of a given type.',
        params: {
            'type': { type: 'BlockName', description: 'The block type to collect.' },
            'num': { type: 'int', description: 'The number of blocks to collect.', domain: [1, Number.MAX_SAFE_INTEGER] }
        },
        perform: makeActionTaskRunner('collectBlocks', async (skills, agent, type, num) => {
            const result = await skills.collectBlock(agent.bot, type, num);
            console.log('collectBlocks', { result });
        }, false, 10) // 10 minute timeout
    },
    {
        name: '!collectAllBlocks',
        description: 'Collect all the nearest blocks of a given type until told to stop.',
        params: {
            'type': { type: 'BlockName', description: 'The block type to collect.' }
        },
        perform: makeActionTaskRunner('collectAllBlocks', async (skills, agent, type) => {
            while (true) {
                let success = await skills.collectBlock(agent.bot, type, 1);
                if (!success) break;
            }
        }, true, 3) // 3 minute timeout
    },
    {
        name: '!craftRecipe',
        description: 'Craft the given recipe a given number of times.',
        params: {
            'recipe_name': { type: 'ItemName', description: 'The name of the output item to craft.' },
            'num': { type: 'int', description: 'The number of times to craft the recipe. This is NOT the number of output items, as it may craft many more items depending on the recipe.', domain: [1, Number.MAX_SAFE_INTEGER] }
        },
        perform: makeActionTaskRunner('craftRecipe', async (skills, agent, recipe_name, num) => {
            await skills.craftRecipe(agent.bot, recipe_name, num);
        })
    },
    {
        name: '!smeltItem',
        description: 'Smelt the given item the given number of times.',
        params: {
            'item_name': { type: 'ItemName', description: 'The name of the input item to smelt.' },
            'num': { type: 'int', description: 'The number of times to smelt the item.', domain: [1, Number.MAX_SAFE_INTEGER] }
        },
        perform: makeActionTaskRunner('smeltItem', async (skills, agent, item_name, num) => {
            let response = await skills.smeltItem(agent.bot, item_name, num);
            console.log('smeltItem', { response });
            if (!response.indexOf) return;
            if (response.indexOf('Successfully') !== -1) {
            // there is a bug where the bot's inventory is not updated after smelting
            // only updates after a restart
            agent.cleanKill(response + ' Safely restarting to update inventory.');
            }
            return response;
        })
    },
    {
        name: '!clearFurnace',
        description: 'Take all items out of the nearest furnace.',
        params: { },
        perform: makeActionTaskRunner('clearFurnace', async (skills, agent) => {
            await skills.clearNearestFurnace(agent.bot);
        })
        },
        {
        name: '!placeHere',
        description: 'Place a given block in the current location. Do NOT use to build structures, only use for single blocks/torches.',
        params: {'type': { type: 'BlockName', description: 'The block type to place.' }},
        perform: makeActionTaskRunner('placeHere', async (skills, agent, type) => {
            let pos = agent.bot.entity.position;
            await skills.placeBlock(agent.bot, type, pos.x, pos.y, pos.z);
        })
    },
    {
        name: '!attack',
        description: 'Attack and kill the nearest entity of a given type.',
        params: {'type': { type: 'string', description: 'The type of entity to attack.'}},
        perform: makeActionTaskRunner('attack', async (skills, agent, type) => {
            await skills.attackNearest(agent.bot, type, true);
        })
    },
    {
        name: '!goToBed',
        description: 'Go to the nearest bed and sleep.',
        perform: makeActionTaskRunner('goToBed', async (skills, agent) => {
            await skills.goToBed(agent.bot);
        })
    },
    {
        name: '!activate',
        description: 'Activate the nearest object of a given type.',
        params: {'type': { type: 'BlockName', description: 'The type of object to activate.' }},
        perform: makeActionTaskRunner('activate', async (skills, agent, type) => {
            await skills.activateNearestBlock(agent.bot, type);
        })
    },
    {
        name: '!stay',
        description: 'Stay in the current location no matter what. Pauses all modes.',
        perform: makeActionTaskRunner('stay', async (skills, agent) => {
            await skills.stay(agent.bot);
        })
    },
    {
        name: '!setMode',
        description: 'Set a mode to on or off. A mode is an automatic behavior that constantly checks and responds to the environment.',
        params: {
            'mode_name': { type: 'string', description: 'The name of the mode to enable.' },
            'on': { type: 'boolean', description: 'Whether to enable or disable the mode.' }
        },
        perform: async function (agent, mode_name, on) {
            const modes = agent.bot.modes;
            if (!modes.exists(mode_name))
            return `Mode ${mode_name} does not exist.` + modes.getDocs();
            if (modes.isOn(mode_name) === on)
            return `Mode ${mode_name} is already ${on ? 'on' : 'off'}.`;
            modes.setOn(mode_name, on);
            return `Mode ${mode_name} is now ${on ? 'on' : 'off'}.`;
        }
    },
    {
        name: '!goal',
        description: 'Set a goal prompt to endlessly work towards with continuous self-prompting.',
        params: {
            'selfPrompt': { type: 'string', description: 'The goal prompt.' },
        },
        perform: makeActionTaskRunner('goal', async (skills, agent, prompt) => {
            const taskFinalizationPromiseKit = makePromiseKit();
            let currentTaskPromise = null;
            const setCurrentTaskPromise = (taskPromise) => {
                if (currentTaskPromise) {
                    // ignore errors from previous task
                    currentTaskPromise.catch(() => {});
                }
                currentTaskPromise = taskPromise;
                if (!taskPromise) return;
                taskPromise.finally(() => {
                    if (taskPromise !== currentTaskPromise) return;
                    taskFinalizationPromiseKit.resolve(taskPromise);
                });
            }
            let selfPrompter;
            const promptUntilEnd = async (prompt) => {
                agent.goal = prompt;
                // manual start
                selfPrompter.on = true;
                selfPrompter.prompt = prompt;
                // loop until stopped
                while (selfPrompter.on) {
                    if (selfPrompter.loop_active) {
                        console.log('!!! Self-prompt loop is already active. Ignoring request.');
                        return;
                    }
                    await selfPrompter.startLoop();
                }
            }
            const task = {
                label: 'goal',
                resultLog: '',
                description: prompt,
                start: async () => {
                    selfPrompter = new SelfPrompter(agent);
                    const taskPromise = promptUntilEnd(prompt);
                    setCurrentTaskPromise(taskPromise);
                    return taskFinalizationPromiseKit.promise;
                },
                pause: async () => {
                    setCurrentTaskPromise(undefined);
                    selfPrompter.stop(false);
                },
                resume: async () => {
                    selfPrompter = new SelfPrompter(agent);
                    const taskPromise = promptUntilEnd(prompt);
                    setCurrentTaskPromise(taskPromise);
                },
                whenDone: () => {
                    return taskFinalizationPromiseKit.promise;
                }
            }
            console.log('starting goal', { prompt });
            // agent.self_prompter.start(prompt); // don't await, don't return
            agent.tasks._executeTask(task);
        }),
    },
    {
        name: '!endGoal',
        description: 'Call when you have accomplished your goal. It will stop self-prompting and the current action. ',
        perform: async function (agent) {
            agent.self_prompter.stop();
            return 'Self-prompting stopped.';
        }
    },
    // { // commented for now, causes confusion with goal command
    //     name: '!npcGoal',
    //     description: 'Set a simple goal for an item or building to automatically work towards. Do not use for complex goals.',
    //     params: {
    //         'name': { type: 'string', description: 'The name of the goal to set. Can be item or building name. If empty will automatically choose a goal.' },
    //         'quantity': { type: 'int', description: 'The quantity of the goal to set. Default is 1.', domain: [1, Number.MAX_SAFE_INTEGER] }
    //     },
    //     perform: async function (agent, name=null, quantity=1) {
    //         await agent.npc.setGoal(name, quantity);
    //         agent.bot.emit('idle');  // to trigger the goal
    //         return 'Set npc goal: ' + agent.npc.data.curr_goal.name;
    //     }
    // },
];
