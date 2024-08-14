package org.zerock.chain.repository;

import org.springframework.data.jpa.repository.JpaRepository;
import org.zerock.chain.domain.ApprovalEntity;

public interface ApprovalRepository extends JpaRepository<ApprovalEntity, Integer> {
}
