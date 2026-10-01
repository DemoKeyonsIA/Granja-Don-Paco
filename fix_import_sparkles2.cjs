const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf8');

code = code.replace(/import \{ .* \} from 'lucide-react';/, "import { Activity, Bot, ChevronRight, DollarSign, LayoutDashboard, LogOut, PackageOpen, Plus, Send, Settings, User as UserIcon, X, Loader2, Info, Navigation, Truck, RefreshCcw, Sparkles, Menu, Search } from 'lucide-react';");
code = code.replace(/import \{ User, ExtractedData \} from "\.\/types";/, "import { User } from './types';");

fs.writeFileSync('src/App.tsx', code);
