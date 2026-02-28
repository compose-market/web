import { Divide, Cpu, Share2, Box, Layers, Wallet, Globe, Zap } from "lucide-react";

export interface Agent {
  id: string;
  name: string;
  description: string;
  type: "LLM" | "Utility" | "Finance" | "Social";
  pricePerUse: number; // in x402 tokens
  reputation: number; // ERC8004 score
  imageUrl: string;
  owner: string;
  model: string;
  isCloneable: boolean;
  cloneFee?: number;
}

export interface Workflow {
  id: string;
  name: string;
  description: string;
  author: string;
  price: number; // Lease price
  agents: string[]; // IDs of agents
  usageCount: number;
  rating: number;
}

export const MOCK_AGENTS: Agent[] = [
  {
    id: "a1",
    name: "Alpha Strategist",
    description: "High-frequency trading analysis agent specialized in DeFi markets on Avalanche.",
    type: "Finance",
    pricePerUse: 0.05,
    reputation: 98,
    imageUrl: "/attached_assets/generated_images/3d_agent_icon.png",
    owner: "0x71C...9A2",
    model: "Llama-3-70b-Instruct",
    isCloneable: true,
    cloneFee: 10
  },
  {
    id: "a2",
    name: "CopyWriter Pro",
    description: "Generates high-converting marketing copy for web3 projects.",
    type: "LLM",
    pricePerUse: 0.02,
    reputation: 85,
    imageUrl: "/attached_assets/generated_images/3d_agent_icon.png",
    owner: "0x3bD...7f1",
    model: "asi1-mini",
    isCloneable: false
  },
  {
    id: "a3",
    name: "Social Sentinel",
    description: "Monitors Twitter/X for brand mentions and sentiment analysis.",
    type: "Social",
    pricePerUse: 0.01,
    reputation: 92,
    imageUrl: "/attached_assets/generated_images/3d_agent_icon.png",
    owner: "0x92A...4bC",
    model: "Claude-3-Sonnet",
    isCloneable: true,
    cloneFee: 5
  },
  {
    id: "a4",
    name: "Code Auditor",
    description: "Audits smart contracts for common vulnerabilities using static analysis.",
    type: "Utility",
    pricePerUse: 0.1,
    reputation: 99,
    imageUrl: "/attached_assets/generated_images/3d_agent_icon.png",
    owner: "0x11F...22E",
    model: "DeepSeek-Coder",
    isCloneable: true,
    cloneFee: 25
  },
  {
    id: "a5",
    name: "Research Synthesizer",
    description: "Aggregates and summarizes whitepapers and technical documentation.",
    type: "LLM",
    pricePerUse: 0.03,
    reputation: 88,
    imageUrl: "/attached_assets/generated_images/3d_agent_icon.png",
    owner: "0x55D...33A",
    model: "Mixtral-8x7b",
    isCloneable: true,
    cloneFee: 8
  }
];

export const MOCK_WORKFLOWS: Workflow[] = [
  {
    id: "w1",
    name: "DeFi Alpha Loop",
    description: "Monitors market sentiment -> Analyzes token volume -> Executes swap if confidence > 80%.",
    author: "0x71C...9A2",
    price: 50,
    agents: ["a3", "a1", "a4"],
    usageCount: 1240,
    rating: 4.9
  },
  {
    id: "w2",
    name: "Content Autopilot",
    description: "Trends research -> Draft generation -> Image creation -> Social posting.",
    author: "0x3bD...7f1",
    price: 25,
    agents: ["a3", "a2"],
    usageCount: 850,
    rating: 4.7
  }
];
