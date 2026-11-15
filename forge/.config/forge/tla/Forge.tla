------------------------------- MODULE Forge -------------------------------
(***************************************************************************)
(* The forge coordinator state machine, as SPEC.md describes it.           *)
(*                                                                         *)
(* A run has cycles. Each cycle walks the phases grill -> verify -> gate   *)
(* -> exec -> done. Agents (nodes) run only in the work phases. A node     *)
(* that fails is retried; after 2 identical errors it evolves into a new   *)
(* node (gen + 1). Any move to an earlier phase opens a new cycle, so      *)
(* inside one cycle the phase only moves forward.                          *)
(*                                                                         *)
(* Failures are bounded by MaxFail and cycles by MaxCycles. This is the    *)
(* finite-failure assumption: without it no run can be shown to end.       *)
(***************************************************************************)
EXTENDS Naturals, FiniteSets

CONSTANTS GrillNodes, VerifyNodes, ExecNodes, Cap, MaxFail, MaxCycles

Nodes == GrillNodes \cup VerifyNodes \cup ExecNodes

ASSUME /\ GrillNodes \cap VerifyNodes = {}
       /\ GrillNodes \cap ExecNodes = {}
       /\ VerifyNodes \cap ExecNodes = {}
       /\ Cap \in Nat \ {0}
       /\ MaxFail \in Nat
       /\ MaxCycles \in Nat \ {0}

PhaseOf(n) == IF n \in GrillNodes THEN "grill"
              ELSE IF n \in VerifyNodes THEN "verify"
              ELSE "exec"

Work == {"grill", "verify", "exec"}

Idx(p) == CASE p = "grill"  -> 1
          []   p = "verify" -> 2
          []   p = "gate"   -> 3
          []   p = "exec"   -> 4
          []   p = "done"   -> 5

Next(p) == CASE p = "grill"  -> "verify"
           []   p = "verify" -> "gate"
           []   p = "exec"   -> "done"

VARIABLES cycle,     \* current cycle number
          phase,     \* current phase of the current cycle
          status,    \* status of the current generation of each node
          gen,       \* generation: + 1 on each evolve (a new node in the log)
          sameErr,   \* identical failures in a row, per node
          fails,     \* failures in the whole run (bounded)
          approved,  \* the current spec passed the gate
          startedIn  \* cycle in which each node's agent was started

vars == <<cycle, phase, status, gen, sameErr, fails, approved, startedIn>>

Running    == {n \in Nodes : status[n] = "running"}
InPhase(p) == {n \in Nodes : PhaseOf(n) = p}

TypeOK ==
  /\ cycle \in 1..MaxCycles
  /\ phase \in {"grill", "verify", "gate", "exec", "done"}
  /\ status \in [Nodes -> {"pending", "running", "failed", "done"}]
  /\ gen \in [Nodes -> Nat]
  /\ sameErr \in [Nodes -> 0..2]
  /\ fails \in 0..MaxFail
  /\ approved \in BOOLEAN
  /\ startedIn \in [Nodes -> 0..MaxCycles]

Init ==
  /\ cycle = 1
  /\ phase = "grill"
  /\ status = [n \in Nodes |-> "pending"]
  /\ gen = [n \in Nodes |-> 0]
  /\ sameErr = [n \in Nodes |-> 0]
  /\ fails = 0
  /\ approved = FALSE
  /\ startedIn = [n \in Nodes |-> 0]

\* forge spawn: only nodes of the current phase, at most Cap at once.
Start(n) ==
  /\ phase \in Work
  /\ PhaseOf(n) = phase
  /\ status[n] = "pending"
  /\ Cardinality(Running) < Cap
  /\ status' = [status EXCEPT ![n] = "running"]
  /\ startedIn' = [startedIn EXCEPT ![n] = cycle]
  /\ UNCHANGED <<cycle, phase, gen, sameErr, fails, approved>>

Succeed(n) ==
  /\ status[n] = "running"
  /\ status' = [status EXCEPT ![n] = "done"]
  /\ sameErr' = [sameErr EXCEPT ![n] = 0]
  /\ UNCHANGED <<cycle, phase, gen, fails, approved, startedIn>>

\* same = TRUE: the error signature matches the last one.
Fail(n, same) ==
  /\ status[n] = "running"
  /\ fails < MaxFail
  /\ status' = [status EXCEPT ![n] = "failed"]
  /\ sameErr' = [sameErr EXCEPT ![n] = IF same /\ @ > 0 THEN @ + 1 ELSE 1]
  /\ fails' = fails + 1
  /\ UNCHANGED <<cycle, phase, gen, approved, startedIn>>

\* Same subgraph again.
Retry(n) ==
  /\ status[n] = "failed"
  /\ sameErr[n] < 2
  /\ status' = [status EXCEPT ![n] = "pending"]
  /\ UNCHANGED <<cycle, phase, gen, sameErr, fails, approved, startedIn>>

\* 2 identical errors: a new node with a changed approach and the error as input.
Evolve(n) ==
  /\ status[n] = "failed"
  /\ sameErr[n] >= 2
  /\ gen' = [gen EXCEPT ![n] = @ + 1]
  /\ status' = [status EXCEPT ![n] = "pending"]
  /\ sameErr' = [sameErr EXCEPT ![n] = 0]
  /\ UNCHANGED <<cycle, phase, fails, approved, startedIn>>

\* phase_done: every node of the phase is done.
Advance ==
  /\ phase \in Work
  /\ \A n \in InPhase(phase) : status[n] = "done"
  /\ phase' = Next(phase)
  /\ UNCHANGED <<cycle, status, gen, sameErr, fails, approved, startedIn>>

\* The human gate.
Approve ==
  /\ phase = "gate"
  /\ phase' = "exec"
  /\ approved' = TRUE
  /\ UNCHANGED <<cycle, status, gen, sameErr, fails, startedIn>>

(***************************************************************************)
(* A follow-up, a gate comment, a counterexample, or a review finding that *)
(* changes the spec. The classifier picks the earliest affected phase.     *)
(* It waits for a phase boundary (no node running). Only a code-only       *)
(* change (start = exec) keeps the approval, and it needs one.             *)
(***************************************************************************)
Reopen(start) ==
  /\ cycle < MaxCycles
  /\ Running = {}
  /\ start \in Work
  /\ phase = "done" \/ Idx(start) <= Idx(phase)
  /\ start = "exec" => approved
  /\ cycle' = cycle + 1
  /\ phase' = start
  \* A reopen cannot stop an agent that is already running.
  /\ status' = [n \in Nodes |-> IF status[n] # "running" /\ Idx(PhaseOf(n)) >= Idx(start)
                                 THEN "pending" ELSE status[n]]
  /\ sameErr' = [n \in Nodes |-> 0]
  /\ approved' = (start = "exec")
  /\ UNCHANGED <<gen, fails, startedIn>>

\* The run is done; keeps the final state from counting as a deadlock.
Finished ==
  /\ phase = "done"
  /\ UNCHANGED vars

NextStep ==
  \/ \E n \in Nodes : Start(n) \/ Succeed(n) \/ Retry(n) \/ Evolve(n)
  \/ \E n \in Nodes, same \in BOOLEAN : Fail(n, same)
  \/ Advance
  \/ Approve
  \/ \E start \in Work : Reopen(start)
  \/ Finished

Fairness ==
  /\ \A n \in Nodes : SF_vars(Start(n))
  /\ \A n \in Nodes : WF_vars(Succeed(n))
  /\ \A n \in Nodes : WF_vars(Retry(n))
  /\ \A n \in Nodes : WF_vars(Evolve(n))
  /\ WF_vars(Advance)
  /\ WF_vars(Approve)

Spec == Init /\ [][NextStep]_vars /\ Fairness

---------------------------------------------------------------------------
(* Safety *)

\* forge spawn never runs more than Cap agents.
CapOK == Cardinality(Running) <= Cap

\* No agent from an older cycle is still running.
NoOrphanAgents == \A n \in Running : startedIn[n] = cycle

\* Only nodes of the current phase run.
OnlyCurrentPhaseRuns == \A n \in Running : PhaseOf(n) = phase

\* Every node of an earlier phase is done.
PhaseBarrier == \A n \in Nodes : Idx(PhaseOf(n)) < Idx(phase) => status[n] = "done"

\* No exec without an approved spec.
ExecNeedsApproval == phase = "exec" => approved

\* Forward only: inside a cycle the phase never moves back and a done node
\* stays done; cycles and generations never go down.
ForwardOnly ==
  [][ /\ cycle' >= cycle
      /\ \A n \in Nodes : gen'[n] >= gen[n]
      /\ cycle' = cycle =>
           /\ Idx(phase') >= Idx(phase)
           /\ \A n \in Nodes : status[n] = "done" => status'[n] = "done"
    ]_vars

(* Liveness *)

\* Every run ends, and stays ended.
Termination == <>[](phase = "done")

\* A failed node never stays failed.
NoStuckFailure == \A n \in Nodes : (status[n] = "failed") ~> (status[n] # "failed")

=============================================================================
