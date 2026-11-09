import type {ReactNode} from 'react';
import LiquidShell from '../ui/liquid-shell';
export default function Layout({children}:{children:ReactNode}){return <LiquidShell><div className="v-editor v-legacy-route">{children}</div></LiquidShell>;}
