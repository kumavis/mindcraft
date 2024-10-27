import { inspect } from 'util';
import { Agent } from '../agent/agent.js';
import yargs from 'yargs';

import React, { useState, useEffect } from 'react';
import { Box, render, Text } from 'ink';
import { useStdout } from 'ink';

const h = React.createElement;

const taskEvents = ['task:start', 'task:end', 'task:interrupt', 'task:error', 'task:timeout', 'task:pause', 'idle'];

const useAgentEvents = (agent, eventNames) => {
    const [events, setEvents] = useState([]);
    useEffect(() => {
        if (!agent?.bot) return;
        const handlers = [];
        eventNames.forEach(eventName => {
            const handler = (eventData) => {
                setEvents((prevEvents) => [...prevEvents, { name: eventName, data: eventData }]);
            }
            agent.bot.on(eventName, handler);
            handlers.push(handler);
        });
        return () => {
            eventNames.forEach((eventName, index) => {
                agent.bot.off(eventName, handlers[index]);
            });
        }
    }, [agent?.bot]);
    return events;
}

const AgentTaskLog = ({ agent }) => {
    const events = useAgentEvents(agent, taskEvents);
    return (
        h(Box, { flexGrow: 1, borderStyle: 'round', borderColor: 'red' }, [
            h(Text, { key: 'text' }, [
                `${events.map(({ name, data }) => `${name}: ${inspect(data)}`).join('\n')}`
            ])
        ])
    )
}

const AgentState = ({ agent }) => {
    const [stateDisplay, setStateDisplay] = useState();

    useEffect(() => {
        const interval = setInterval(() => {
            const {
                name,
                coder,
                tasks,
                npc,
            } = agent;
            const { temp_goals, item_goal, build_goal, constructions, last_goals } = npc;

            setStateDisplay(inspect({
                name,
                // npc: {
                //     temp_goals,
                //     item_goal,
                //     build_goal,
                //     constructions,
                //     last_goals
                // },
                modes: agent.bot?.modes.getMiniDocs(),
                codeGenerating: coder.generating,
                taskExecuting: tasks.executing,
                // currentTaskLabel: tasks.currentTaskLabel,
                // currentTask: tasks.currentTaskFn,
                // currentTaskSource: tasks.currentTaskFn?.toString(),
                taskQueue: tasks.taskQueue.map(task => task.label),
            }, { depth: 2, colors: true }));
        }, 200);

        return () => clearInterval(interval);
    }, []);

    return h(Box, { flexGrow: 1, borderStyle: 'round', borderColor: 'blue' }, [
        h(Text, { key: 'text' }, [
            `${stateDisplay}`
        ])
    ]);
}

const AgentSection = ({ agent }) => {
    return (
        h(Box, { flexDirection: 'column', width: '100%' }, [
            h(AgentState, { key: 'state', agent }),
            h(AgentTaskLog, { key: 'tasks', agent }),
        ])
    );
}

const ConsoleDisplay = ({ consoleHistory }) => {
    const maxLines = 40;
    const historyLines = consoleHistory.slice(-maxLines).join('\n').split('\n');
    return (
        h(Box, { flexGrow: 1, borderStyle: 'round', borderColor: 'green' }, [
            h(Text, { key: 'text' }, [
                `${historyLines.slice(-maxLines).join('\n')}`
            ])
        ])
    )
}

let initialized = false;
const App = () => {
    const [consoleLog, setConsoleLog] = useState([]);
    const [agent, setAgent] = useState();
    const [maxColumns, maxRows] = useStdoutDimensions();

    useEffect(() => {
        if (initialized) return;
        initialized = true;
        console.log = (...messages) => {
            const newMessage = messages.map(message => {
                if (typeof message === 'object') {
                    return inspect(message, { depth: 2 });
                }
                return message;
            }).join(' ');
            setConsoleLog((prev) => [...prev, newMessage]);
        };
        console.error = (...messages) => {
            console.log('(ERROR):', ...messages);
        }
        process.on('uncaughtException', (err) => {
            console.error('Uncaught Exception:', err);
        });
        process.on('unhandledRejection', (reason, promise) => {
            console.error('Unhandled Rejection at:', promise, 'reason:', reason);
        });
        setAgent(startAgent());
    }, []);

    const consoleWidthPercent = 50;

    return (
        h(Box, { flexDirection: 'row', height: maxRows }, [
            // Left Column - Console Display
            h(
                Box,
                { key: 'left', width: `${consoleWidthPercent}%` },
                h(ConsoleDisplay, { consoleHistory: consoleLog })
            ),
            // Right Column - Agent State
            h(
                Box,
                { key: 'right', width: `${100 - consoleWidthPercent}%` },
                agent && h(AgentSection, { agent })
            ),
        ])
    )
};

render(h(App));

function startAgent() {
    const args = process.argv.slice(2);
    if (args.length < 1) {
        console.log('Usage: node init_agent.js <agent_name> [profile] [load_memory] [init_message]');
        process.exit(789);
    }

    const argv = yargs(args)
        .option('profile', {
            alias: 'p',
            type: 'string',
            description: 'profile filepath to use for agent'
        })
        .option('load_memory', {
            alias: 'l',
            type: 'boolean',
            description: 'load agent memory from file on startup'
        })
        .option('init_message', {
            alias: 'm',
            type: 'string',
            description: 'automatically prompt the agent on startup'
        })
        .option('count_id', {
            alias: 'c',
            type: 'number',
            default: 0,
            description: 'identifying count for multi-agent scenarios',
        }).argv

    const agent = new Agent()
    agent.start(argv.profile, argv.load_memory, argv.init_message, argv.count_id);
    return agent;
}

function useStdoutDimensions() {
    const { stdout } = useStdout();
    const [dimensions, setDimensions] = useState([stdout.columns, stdout.rows]);

    useEffect(() => {
        const handler = () => setDimensions([stdout.columns, stdout.rows]);
        stdout.on('resize', handler);
        return () => {
            stdout.off('resize', handler);
        };
    }, [stdout]);

    return dimensions;
}