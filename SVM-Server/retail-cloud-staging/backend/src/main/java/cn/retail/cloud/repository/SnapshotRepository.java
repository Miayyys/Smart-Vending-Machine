package cn.retail.cloud.repository;

import cn.retail.cloud.entity.Snapshot;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

import java.time.LocalDateTime;
import java.util.List;

public interface SnapshotRepository extends JpaRepository<Snapshot, Long> {

    long countByDeviceId(String deviceId);

    /** 某设备按时间倒序的一页记录 */
    List<Snapshot> findByDeviceIdOrderByCreateTimeDesc(String deviceId, Pageable pageable);

    /** 某设备某动作的一页记录（OPEN/CLOSE 筛选） */
    List<Snapshot> findByDeviceIdAndDoorActionOrderByCreateTimeDesc(String deviceId, String doorAction, Pageable pageable);

    /** 全部按时间倒序的一页 */
    List<Snapshot> findAllByOrderByCreateTimeDesc(Pageable pageable);

    /** 全部某动作按时间倒序的一页 */
    List<Snapshot> findByDoorActionOrderByCreateTimeDesc(String doorAction, Pageable pageable);

    /** 某设备+楼层+动作的最近 N 条 */
    List<Snapshot> findByDeviceIdAndFloorAndDoorActionOrderByCreateTimeDesc(
            String deviceId, Integer floor, String doorAction, Pageable pageable);

    /** 某设备最旧的 N 条（用于自动清理时按 id 升序取要删的） */
    List<Snapshot> findByDeviceIdOrderByIdAsc(String deviceId, Pageable pageable);

    /** 创建时间早于 cutoff 的记录（用于定时清理） */
    @Query("select s from Snapshot s where s.createTime < ?1 order by s.createTime asc")
    List<Snapshot> findByCreateTimeBefore(LocalDateTime cutoff);
}