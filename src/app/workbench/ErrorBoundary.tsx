import { Component, type ReactNode } from 'react';
import { log } from '../output';

/** 一个视图出错只影响它自己，不拖垮整个 workbench。 */
export class ErrorBoundary extends Component<{ name: string; children: ReactNode }, { error: Error | null }> {
    state: { error: Error | null } = { error: null };

    static getDerivedStateFromError(error: Error) {
        return { error };
    }

    componentDidCatch(error: Error) {
        log(`视图「${this.props.name}」出错：${error.message}`, 'error');
    }

    render() {
        if (!this.state.error) return this.props.children;
        return (
            <div className="space-y-2 px-4 py-3 text-xs">
                <div className="text-red-300">「{this.props.name}」出错了：{this.state.error.message}</div>
                <button
                    type="button"
                    onClick={() => this.setState({ error: null })}
                    className="rounded border border-zinc-700 px-2 py-1 text-zinc-300 hover:bg-zinc-800"
                >
                    重试
                </button>
            </div>
        );
    }
}
